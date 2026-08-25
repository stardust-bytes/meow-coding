package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestValidateRejectsNonLoopbackHost(t *testing.T) {
	cfg := runtimeConfig{Host: "0.0.0.0", Port: 40000, Accounts: []accountConfig{{
		ID: "a", Credential: "cred-a", Tokens: tokenData{AccessToken: "tok-a"},
	}}}
	if err := validate(&cfg); err == nil {
		t.Fatal("expected non-loopback host to be rejected")
	}
}

func TestValidateAcceptsLoopbackHost(t *testing.T) {
	cfg := runtimeConfig{Host: "127.0.0.1", Port: 40000, Accounts: []accountConfig{{
		ID: "a", Credential: "cred-a", Tokens: tokenData{AccessToken: "tok-a"},
	}}}
	if err := validate(&cfg); err != nil {
		t.Fatalf("expected loopback host to be accepted: %v", err)
	}
}

func TestValidateRejectsReservedModelsPathAccountID(t *testing.T) {
	cfg := runtimeConfig{Host: "127.0.0.1", Port: 40000, Accounts: []accountConfig{{
		ID: "modelsPath", Credential: "cred-a", Tokens: tokenData{AccessToken: "tok-a"},
	}}}
	if err := validate(&cfg); err == nil {
		t.Fatal("expected reserved modelsPath account ID to be rejected")
	}
}

func TestValidateRejectsDuplicateCredentials(t *testing.T) {
	cfg := runtimeConfig{Host: "127.0.0.1", Port: 40000, Accounts: []accountConfig{
		{ID: "a", Credential: "cred-a", Tokens: tokenData{AccessToken: "tok-a"}},
		{ID: "b", Credential: "cred-a", Tokens: tokenData{AccessToken: "tok-b"}},
	}}
	if err := validate(&cfg); err == nil {
		t.Fatal("expected a credential reused across accounts to be rejected")
	}
}

func TestValidateRejectsEmptyAccessToken(t *testing.T) {
	cfg := runtimeConfig{Host: "127.0.0.1", Port: 40000, Accounts: []accountConfig{{
		ID: "a", Credential: "cred-a", Tokens: tokenData{},
	}}}
	if err := validate(&cfg); err == nil {
		t.Fatal("expected an account without an access token to be rejected")
	}
}

func TestSanitizeFileName(t *testing.T) {
	if got := sanitizeFileName("acct-a@example.com"); got != "acct-a_example_com" {
		t.Fatalf("unexpected sanitized name: %q", got)
	}
}

func TestProjectCodexModelCatalog(t *testing.T) {
	raw := []byte(`{
		"models": [
			{
				"slug": " gpt-5.6 ",
				"display_name": " GPT-5.6 ",
				"supported_reasoning_levels": [
					{"effort": "low"}, {"effort": " ultra "}, {"effort": "low"},
					{"effort": ""}, {"effort": 42}, null
				]
			},
			{
				"slug": "gpt-no-effort",
				"display_name": " ",
				"supported_reasoning_levels": [{"effort": null}, {"wrong": "high"}]
			},
			{"slug": " "},
			"not-a-model"
		]
	}`)

	catalog, err := projectCodexModelCatalog(raw)
	if err != nil {
		t.Fatalf("project catalog: %v", err)
	}
	want := modelCatalogResponse{Data: []modelCatalogEntry{
		{ID: "gpt-5.6", Name: "GPT-5.6", Variants: []string{"low", "ultra"}},
		{ID: "gpt-no-effort", Name: "gpt-no-effort", Variants: []string{}},
	}}
	if !equalCatalog(catalog, want) {
		t.Fatalf("unexpected catalog:\n got: %#v\nwant: %#v", catalog, want)
	}
}

func TestProjectCodexModelCatalogAllowsEmptyRegistry(t *testing.T) {
	catalog, err := projectCodexModelCatalog(nil)
	if err != nil {
		t.Fatalf("project empty catalog: %v", err)
	}
	if len(catalog.Data) != 0 {
		t.Fatalf("empty registry produced catalog: %#v", catalog)
	}

	modelsPath, err := writeModelCatalog(t.TempDir(), catalog)
	if err != nil {
		t.Fatalf("write empty catalog: %v", err)
	}
	raw, err := os.ReadFile(modelsPath)
	if err != nil {
		t.Fatalf("read empty catalog: %v", err)
	}
	if string(raw) != "{\n  \"data\": []\n}" {
		t.Fatalf("unexpected empty catalog JSON: %s", raw)
	}
}

func TestWriteModelCatalogAndStatusFile(t *testing.T) {
	runDir := t.TempDir()
	catalog := modelCatalogResponse{Data: []modelCatalogEntry{{
		ID: "gpt-5.6", Name: "GPT-5.6", Variants: []string{"high", "ultra"},
	}}}
	modelsPath, err := writeModelCatalog(runDir, catalog)
	if err != nil {
		t.Fatalf("write model catalog: %v", err)
	}
	if modelsPath != filepath.Join(runDir, "models.json") {
		t.Fatalf("unexpected models path: %q", modelsPath)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(modelsPath)
		if err != nil {
			t.Fatalf("stat models file: %v", err)
		}
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("models file permissions = %o, want 600", got)
		}
	}

	var written modelCatalogResponse
	raw, err := os.ReadFile(modelsPath)
	if err != nil {
		t.Fatalf("read models file: %v", err)
	}
	if err := json.Unmarshal(raw, &written); err != nil {
		t.Fatalf("decode models file: %v", err)
	}
	if !equalCatalog(written, catalog) {
		t.Fatalf("unexpected written catalog: %#v", written)
	}

	statusPath := filepath.Join(runDir, "status.json")
	if err := writeStatusFile(statusPath, map[string]statusEntry{"account-1": {Port: 40100}}, modelsPath); err != nil {
		t.Fatalf("write status: %v", err)
	}
	var status struct {
		ModelsPath string                 `json:"modelsPath"`
		Account    statusEntry            `json:"account-1"`
	}
	raw, err = os.ReadFile(statusPath)
	if err != nil {
		t.Fatalf("read status file: %v", err)
	}
	if err := json.Unmarshal(raw, &status); err != nil {
		t.Fatalf("decode status file: %v", err)
	}
	if status.ModelsPath != modelsPath || status.Account.Port != 40100 {
		t.Fatalf("unexpected status: %#v", status)
	}
}

func equalCatalog(got, want modelCatalogResponse) bool {
	if len(got.Data) != len(want.Data) {
		return false
	}
	for i := range got.Data {
		if got.Data[i].ID != want.Data[i].ID || got.Data[i].Name != want.Data[i].Name || len(got.Data[i].Variants) != len(want.Data[i].Variants) {
			return false
		}
		for j := range got.Data[i].Variants {
			if got.Data[i].Variants[j] != want.Data[i].Variants[j] {
				return false
			}
		}
	}
	return true
}
