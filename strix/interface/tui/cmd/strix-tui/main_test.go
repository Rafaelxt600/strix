package main

import (
	"testing"

	"github.com/usestrix/strix/tui/internal/app"
)

func TestAppVersionAccessor(t *testing.T) {
	app.SetVersion("2.0.0")
	if v := app.Version(); v != "2.0.0" {
		t.Fatalf("expected version 2.0.0, got %s", v)
	}

	app.SetVersion("")
	if v := app.Version(); v != "2.0.0" {
		t.Fatalf("empty string should not overwrite version, got %s", v)
	}
}
