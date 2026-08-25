// meow-cliproxy is a Meow-owned wrapper around CLIProxyAPI (MIT). It runs one
// account-scoped OpenAI-compatible proxy per Codex account, each bound to a
// distinct loopback port. A request can only ever be served by the account
// whose local credential is listed in the runtime config; unknown credentials
// are rejected and no automatic account rotation or fallback is applied.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/registry"
	sdkapi "github.com/router-for-me/CLIProxyAPI/v7/sdk/api"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
	// Register the request/response translators (chat-completions -> codex
	// Responses, etc.). Without this the proxy forwards the raw chat-completions
	// body to the Codex backend, which rejects it with HTTP 400 for every model.
	_ "github.com/router-for-me/CLIProxyAPI/v7/internal/translator"
	log "github.com/sirupsen/logrus"
)

type tokenData struct {
	AccessToken         string `json:"accessToken"`
	RefreshToken        string `json:"refreshToken"`
	IDToken             string `json:"idToken"`
	AccessTokenExpiresAt string `json:"accessTokenExpiresAt"`
}

type accountConfig struct {
	ID         string    `json:"id"`
	Credential string    `json:"credential"`
	Tokens     tokenData `json:"tokens"`
}

type runtimeConfig struct {
	Host     string          `json:"host"`
	Port     int             `json:"port"`
	Accounts []accountConfig `json:"accounts"`
}

const modelsPathStatusKey = "modelsPath"

type statusEntry struct {
	Port int `json:"port"`
}

type modelCatalogEntry struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Variants []string `json:"variants"`
}

type modelCatalogResponse struct {
	Data []modelCatalogEntry `json:"data"`
}

type codexRegistryPayload struct {
	Models []json.RawMessage `json:"models"`
}

type codexRegistryModel struct {
	Slug                     any             `json:"slug"`
	DisplayName              any             `json:"display_name"`
	SupportedReasoningLevels json.RawMessage `json:"supported_reasoning_levels"`
}

type codexReasoningLevel struct {
	Effort any `json:"effort"`
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "meow-cliproxy: "+format+"\n", args...)
	os.Exit(1)
}

func isLoopbackHost(host string) bool {
	h := strings.TrimSpace(host)
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func validate(cfg *runtimeConfig) error {
	if !isLoopbackHost(cfg.Host) {
		return fmt.Errorf("host must be loopback (127.0.0.1/::1), got %q", cfg.Host)
	}
	if cfg.Port < 1024 || cfg.Port > 65535 {
		return fmt.Errorf("port %d out of range", cfg.Port)
	}
	if len(cfg.Accounts) == 0 {
		return errors.New("no accounts configured")
	}
	ids := map[string]struct{}{}
	creds := map[string]struct{}{}
	for i, acc := range cfg.Accounts {
		if strings.TrimSpace(acc.ID) == "" {
			return fmt.Errorf("account %d has no id", i)
		}
		if acc.ID == modelsPathStatusKey {
			return fmt.Errorf("account id %q is reserved", acc.ID)
		}
		if strings.TrimSpace(acc.Credential) == "" {
			return fmt.Errorf("account %q has no local credential", acc.ID)
		}
		if strings.TrimSpace(acc.Tokens.AccessToken) == "" {
			return fmt.Errorf("account %q has no access token", acc.ID)
		}
		if _, dup := ids[acc.ID]; dup {
			return fmt.Errorf("duplicate account id %q", acc.ID)
		}
		if _, dup := creds[acc.Credential]; dup {
			return fmt.Errorf("credential reused across accounts")
		}
		ids[acc.ID] = struct{}{}
		creds[acc.Credential] = struct{}{}
	}
	if len(cfg.Accounts) > 65535-cfg.Port {
		return errors.New("too many accounts for the port range")
	}
	return nil
}

func sanitizeFileName(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	out := b.String()
	if out == "" {
		return "account"
	}
	return out
}

// writeAuthFile persists one Codex OAuth bundle in the metadata format the
// CLIProxyAPI file synthesizer expects (type + token fields under Metadata).
func writeAuthFile(dir string, acc accountConfig) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	now := time.Now().Format(time.RFC3339)
	meta := map[string]any{
		"type":          "codex",
		"id_token":      acc.Tokens.IDToken,
		"access_token":  acc.Tokens.AccessToken,
		"refresh_token": acc.Tokens.RefreshToken,
		"expired":       acc.Tokens.AccessTokenExpiresAt,
		"last_refresh":  now,
	}
	raw, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "codex.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return err
	}
	return nil
}

func writeYAML(path string, host string, port int, authDir string, credential string) error {
	// Only loopback binding, a single allowed API key and a single auth file
	// are configured per service instance; the selector has nothing to rotate.
	yaml := fmt.Sprintf("host: %q\nport: %d\nauth-dir: %q\napi-keys:\n  - %q\ndebug: false\n", host, port, authDir, credential)
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		return err
	}
	return nil
}

func projectCodexModelCatalog(raw []byte) (modelCatalogResponse, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return modelCatalogResponse{Data: []modelCatalogEntry{}}, nil
	}

	var payload codexRegistryPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return modelCatalogResponse{}, fmt.Errorf("decode Codex model registry: %w", err)
	}

	catalog := modelCatalogResponse{Data: make([]modelCatalogEntry, 0, len(payload.Models))}
	for _, rawModel := range payload.Models {
		var model codexRegistryModel
		if err := json.Unmarshal(rawModel, &model); err != nil {
			continue
		}
		id, ok := model.Slug.(string)
		id = strings.TrimSpace(id)
		if !ok || id == "" {
			continue
		}

		name, _ := model.DisplayName.(string)
		name = strings.TrimSpace(name)
		if name == "" {
			name = id
		}

		var levels []json.RawMessage
		_ = json.Unmarshal(model.SupportedReasoningLevels, &levels)
		variants := make([]string, 0, len(levels))
		seen := make(map[string]struct{}, len(levels))
		for _, rawLevel := range levels {
			var level codexReasoningLevel
			if err := json.Unmarshal(rawLevel, &level); err != nil {
				continue
			}
			effort, ok := level.Effort.(string)
			effort = strings.TrimSpace(effort)
			if !ok || effort == "" {
				continue
			}
			if _, exists := seen[effort]; exists {
				continue
			}
			seen[effort] = struct{}{}
			variants = append(variants, effort)
		}
		catalog.Data = append(catalog.Data, modelCatalogEntry{ID: id, Name: name, Variants: variants})
	}
	return catalog, nil
}

func writeModelCatalog(runDir string, catalog modelCatalogResponse) (string, error) {
	raw, err := json.MarshalIndent(catalog, "", "  ")
	if err != nil {
		return "", err
	}
	modelsPath := filepath.Join(runDir, "models.json")
	if err := os.WriteFile(modelsPath, raw, 0o600); err != nil {
		return "", err
	}
	if err := os.Chmod(modelsPath, 0o600); err != nil {
		return "", err
	}
	return modelsPath, nil
}

func writeStatusFile(statusPath string, accounts map[string]statusEntry, modelsPath string) error {
	status := make(map[string]any, len(accounts)+1)
	for accountID, entry := range accounts {
		status[accountID] = entry
	}
	status[modelsPathStatusKey] = modelsPath
	raw, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(statusPath, raw, 0o600); err != nil {
		return err
	}
	return os.Chmod(statusPath, 0o600)
}

func waitHealthy(ctx context.Context, host string, port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	url := fmt.Sprintf("http://%s:%d/healthz", host, port)
	client := &http.Client{Timeout: 2 * time.Second}
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		resp, err := client.Get(url)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("sidecar on port %d did not become healthy", port)
}

func run() error {
	host := flag.String("host", "127.0.0.1", "loopback bind host")
	port := flag.Int("port", 0, "base port for per-account proxies")
	configPath := flag.String("config", "", "path to the runtime config JSON")
	statusPath := flag.String("status", "", "path to write the account->port mapping")
	flag.Parse()

	if *configPath == "" {
		return errors.New("--config is required")
	}
	if *port <= 0 {
		return errors.New("--port is required")
	}
	raw, err := os.ReadFile(*configPath)
	if err != nil {
		return fmt.Errorf("read config: %w", err)
	}
	var cfg runtimeConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return fmt.Errorf("parse config: %w", err)
	}
	if cfg.Host == "" {
		cfg.Host = *host
	}
	if cfg.Port == 0 {
		cfg.Port = *port
	}
	if err := validate(&cfg); err != nil {
		return err
	}

	runDir := filepath.Dir(*configPath)
	authRoot := filepath.Join(runDir, "auth")
	if err := os.MkdirAll(authRoot, 0o700); err != nil {
		return err
	}
	registryJSON, _ := registry.GetCodexClientModelsSnapshot()
	catalog, err := projectCodexModelCatalog(registryJSON)
	if err != nil {
		return err
	}
	modelsPath, err := writeModelCatalog(runDir, catalog)
	if err != nil {
		return fmt.Errorf("write model catalog: %w", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	services := make([]*cliproxy.Service, 0, len(cfg.Accounts))
	status := map[string]statusEntry{}

	for i, acc := range cfg.Accounts {
		accPort := cfg.Port + i
		authDir := filepath.Join(authRoot, sanitizeFileName(acc.ID))
		if err := writeAuthFile(authDir, acc); err != nil {
			return fmt.Errorf("write auth for %q: %w", acc.ID, err)
		}
		yamlPath := filepath.Join(runDir, fmt.Sprintf("config-%s.yaml", sanitizeFileName(acc.ID)))
		if err := writeYAML(yamlPath, cfg.Host, accPort, authDir, acc.Credential); err != nil {
			return fmt.Errorf("write config for %q: %w", acc.ID, err)
		}
		serviceCfg, err := sdkconfig.LoadConfig(yamlPath)
		if err != nil {
			return fmt.Errorf("load proxy config for %q: %w", acc.ID, err)
		}
		service, err := cliproxy.NewBuilder().
			WithConfig(serviceCfg).
			WithConfigPath(yamlPath).
			WithServerOptions(sdkapi.WithLocalManagementPassword("")).
			Build()
		if err != nil {
			return fmt.Errorf("build proxy for %q: %w", acc.ID, err)
		}
		services = append(services, service)
		status[acc.ID] = statusEntry{Port: accPort}
	}

	errCh := make(chan error, len(services))
	for _, service := range services {
		go func(s *cliproxy.Service) {
			if err := s.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
				errCh <- err
			}
		}(service)
	}

	for _, entry := range status {
		if err := waitHealthy(ctx, cfg.Host, entry.Port, 15*time.Second); err != nil {
			cancel()
			return err
		}
	}

	if *statusPath != "" {
		if err := writeStatusFile(*statusPath, status, modelsPath); err != nil {
			return fmt.Errorf("write status: %w", err)
		}
	}

	log.Infof("meow-cliproxy ready: %d account(s) on %s", len(status), cfg.Host)

	select {
	case <-ctx.Done():
		return nil
	case err := <-errCh:
		return err
	}
}

func main() {
	if err := run(); err != nil {
		fail("%v", err)
	}
}


