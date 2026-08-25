package main

import (
	"testing"

	sdktranslator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
)

// The wrapper registers the internal translators via a blank import in
// main.go. Without them the proxy would forward raw chat-completions bodies to
// the Codex backend, which answers HTTP 400 for every model. This test locks
// that behaviour in.
func TestCodexTranslatorRegistered(t *testing.T) {
	payload := []byte(`{"model":"gpt-5.3-codex","messages":[{"role":"system","content":"You are helpful."},{"role":"user","content":"hi"}],"tools":[{"type":"function","function":{"name":"read_file","description":"read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}],"tool_choice":"auto","stream":true}`)
	body := sdktranslator.TranslateRequest(sdktranslator.FormatOpenAI, sdktranslator.FormatCodex, "gpt-5.3-codex", payload, false)

	if len(body) == 0 {
		t.Fatal("empty translated body")
	}
	// The codex Responses format carries input/instructions instead of the
	// chat-completions messages array.
	if string(body) == string(payload) {
		t.Fatalf("translator not registered; body passed through unchanged: %s", body)
	}
}
