package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/usestrix/strix/tui/internal/app"
	"github.com/usestrix/strix/tui/internal/render"
)

func main() {
	app.SetVersion(os.Getenv("STRIX_VERSION"))
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version", "-version", "-v", "version":
			fmt.Printf("strix-tui v%s\n", app.Version())
			os.Exit(0)
		case "--help", "-help", "-h", "help":
			fmt.Println("Strix Terminal User Interface (TUI) sidecar")
			fmt.Println("\nUsage:")
			fmt.Println("  strix-tui [flags]")
			fmt.Println("\nFlags:")
			fmt.Println("  -v, --version  Show version information")
			fmt.Println("  -h, --help     Show this help message")
			os.Exit(0)
		}
	}
	render.DetectKittyGraphics()
	client, err := app.ConnectFromEnvironment()
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect to Strix backend:", err)
		os.Exit(1)
	}
	defer client.Close()
	if err := client.Handshake(); err != nil {
		fmt.Fprintln(os.Stderr, "negotiate Strix TUI protocol:", err)
		os.Exit(1)
	}
	program := tea.NewProgram(app.New(client), tea.WithAltScreen(), tea.WithMouseCellMotion())
	finalModel, err := program.Run()
	if err != nil {
		fmt.Fprintln(os.Stderr, "run TUI:", err)
		os.Exit(1)
	}
	if model, ok := finalModel.(interface{ FatalError() error }); ok && model.FatalError() != nil {
		fmt.Fprintln(os.Stderr, "run TUI:", model.FatalError())
		os.Exit(1)
	}
}
