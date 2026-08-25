package main

import "testing"

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
