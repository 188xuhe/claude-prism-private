use std::path::PathBuf;
use std::process::Command;
use tauri::{Emitter, WebviewWindow};
use tokio::io::{AsyncBufReadExt, BufReader};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Pandoc installation status
#[derive(serde::Serialize)]
pub struct PandocStatus {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
}

/// Check if pandoc is installed and return its version.
#[tauri::command]
pub async fn detect_pandoc() -> PandocStatus {
    match find_pandoc() {
        Ok(path) => {
            // Get version
            let version = get_pandoc_version(&path);
            PandocStatus {
                installed: true,
                version,
                path: Some(path.to_string_lossy().into_owned()),
            }
        }
        Err(_) => PandocStatus {
            installed: false,
            version: None,
            path: None,
        },
    }
}

/// Install pandoc automatically (cross-platform).
#[tauri::command]
pub async fn install_pandoc(window: WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        install_pandoc_macos(window).await
    }

    #[cfg(target_os = "windows")]
    {
        install_pandoc_windows(window).await
    }

    #[cfg(target_os = "linux")]
    {
        install_pandoc_linux(window).await
    }
}

/// macOS: Install pandoc via homebrew (most reliable method).
#[cfg(target_os = "macos")]
async fn install_pandoc_macos(window: WebviewWindow) -> Result<(), String> {
    // Check if brew is available
    let brew_available = which::which("brew").is_ok();

    if brew_available {
        let _ = window.emit("pandoc-install-output", "Installing pandoc via Homebrew...");

        let mut cmd = tokio::process::Command::new("brew");
        cmd.args(["install", "pandoc"]);

        // Inherit PATH
        for (key, value) in std::env::vars() {
            if key.eq_ignore_ascii_case("PATH") {
                cmd.env(&key, &value);
            }
        }

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to run brew: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

        let stdout_reader = BufReader::new(stdout);
        let stderr_reader = BufReader::new(stderr);

        // Stream output
        let win_stdout = window.clone();
        tokio::spawn(async move {
            let mut lines = stdout_reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = win_stdout.emit("pandoc-install-output", &line);
            }
        });

        let win_stderr = window.clone();
        tokio::spawn(async move {
            let mut lines = stderr_reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = win_stderr.emit("pandoc-install-output", &line);
            }
        });

        // Wait for completion
        let win_complete = window;
        tokio::spawn(async move {
            let success = match child.wait().await {
                Ok(status) => status.success(),
                Err(_) => false,
            };
            let _ = win_complete.emit("pandoc-install-complete", success);
        });

        Ok(())
    } else {
        // Fallback: download from GitHub releases
        let _ = window.emit("pandoc-install-output", "Homebrew not found. Downloading pandoc...");

        // Download pandoc release
        let temp_dir = std::env::temp_dir();
        let pkg_path = temp_dir.join("pandoc.pkg");

        // Download using curl
        let url = "https://github.com/jgm/pandoc/releases/download/3.1.11/pandoc-3.1.11-x86_64-macOS.pkg";

        let download_output = tokio::process::Command::new("curl")
            .args(["-L", "-o", &pkg_path.to_string_lossy(), url])
            .output()
            .await
            .map_err(|e| format!("Failed to download pandoc: {}", e))?;

        if !download_output.status.success() {
            return Err("Failed to download pandoc package".to_string());
        }

        // Install using installer (requires admin privileges)
        let install_output = tokio::process::Command::new("installer")
            .args(["-pkg", &pkg_path.to_string_lossy(), "-target", "/"])
            .output()
            .await
            .map_err(|e| format!("Failed to install pandoc: {}", e))?;

        // Cleanup
        let _ = std::fs::remove_file(&pkg_path);

        if install_output.status.success() {
            let _ = window.emit("pandoc-install-complete", true);
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&install_output.stderr);
            Err(format!("Installation failed: {}", stderr.trim()))
        }
    }
}

/// Windows: Download and install pandoc from GitHub releases.
#[cfg(target_os = "windows")]
async fn install_pandoc_windows(window: WebviewWindow) -> Result<(), String> {
    let _ = window.emit("pandoc-install-output", "Downloading pandoc for Windows...");

    // Get user temp directory
    let temp_dir = std::env::temp_dir();
    let zip_path = temp_dir.join("pandoc.zip");

    // Download using PowerShell
    let url = "https://github.com/jgm/pandoc/releases/download/3.1.11/pandoc-3.1.11-windows-x86_64.zip";

    let download_result = tokio::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-Command",
            &format!("Invoke-WebRequest -Uri '{}' -OutFile '{}'", url, zip_path.display()),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to download pandoc: {}", e))?;

    if !download_result.status.success() {
        return Err("Failed to download pandoc".to_string());
    }

    let _ = window.emit("pandoc-install-output", "Extracting and installing...");

    // Extract to user's AppData\Local folder
    if let Some(home) = dirs::home_dir() {
        let install_dir = home.join("AppData").join("Local").join("Pandoc");

        // Create directory
        std::fs::create_dir_all(&install_dir)
            .map_err(|e| format!("Failed to create install directory: {}", e))?;

        // Extract using PowerShell
        let extract_result = tokio::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-Command",
                &format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force; Move-Item -Path '{}' -Destination '{}' -Force",
                    zip_path.display(),
                    temp_dir.display(),
                    temp_dir.join("pandoc-3.1.11-windows-x86_64").join("pandoc.exe").display(),
                    install_dir.join("pandoc.exe").display()
                ),
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to extract pandoc: {}", e))?;

        // Cleanup
        let _ = std::fs::remove_file(&zip_path);
        let _ = std::fs::remove_dir_all(temp_dir.join("pandoc-3.1.11-windows-x86_64"));

        if extract_result.status.success() {
            let _ = window.emit("pandoc-install-complete", true);
            Ok(())
        } else {
            Err("Failed to extract pandoc".to_string())
        }
    } else {
        Err("Failed to find user home directory".to_string())
    }
}

/// Linux: Install pandoc via package manager.
#[cfg(target_os = "linux")]
async fn install_pandoc_linux(window: WebviewWindow) -> Result<(), String> {
    let _ = window.emit("pandoc-install-output", "Detecting package manager...");

    // Detect package manager
    let (pm, install_cmd) = if which::which("apt").is_ok() || which::which("apt-get").is_ok() {
        ("apt", vec!["install", "-y", "pandoc"])
    } else if which::which("dnf").is_ok() {
        ("dnf", vec!["install", "-y", "pandoc"])
    } else if which::which("yum").is_ok() {
        ("yum", vec!["install", "-y", "pandoc"])
    } else if which::which("pacman").is_ok() {
        ("pacman", vec!["-S", "--noconfirm", "pandoc"])
    } else {
        return Err("No supported package manager found (apt, dnf, yum, pacman)".to_string());
    };

    let _ = window.emit("pandoc-install-output", format!("Installing pandoc via {}...", pm));

    let mut cmd = tokio::process::Command::new(pm);
    cmd.args(&install_cmd);

    // Inherit PATH
    for (key, value) in std::env::vars() {
        if key.eq_ignore_ascii_case("PATH") {
            cmd.env(&key, &value);
        }
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to run {}: {}", pm, e))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let stdout_reader = BufReader::new(stdout);
    let stderr_reader = BufReader::new(stderr);

    // Stream output
    let win_stdout = window.clone();
    tokio::spawn(async move {
        let mut lines = stdout_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_stdout.emit("pandoc-install-output", &line);
        }
    });

    let win_stderr = window.clone();
    tokio::spawn(async move {
        let mut lines = stderr_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_stderr.emit("pandoc-install-output", &line);
        }
    });

    // Wait for completion
    let win_complete = window;
    tokio::spawn(async move {
        let success = match child.wait().await {
            Ok(status) => status.success(),
            Err(_) => false,
        };
        let _ = win_complete.emit("pandoc-install-complete", success);
    });

    Ok(())
}

/// Get pandoc version string.
fn get_pandoc_version(pandoc_path: &PathBuf) -> Option<String> {
    let mut cmd = Command::new(pandoc_path);
    cmd.arg("--version");

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // First line typically contains version, e.g. "pandoc 3.1.11"
        stdout.lines().next().map(|s| s.trim().to_string())
    } else {
        None
    }
}

/// Find pandoc binary in common locations or on PATH.
fn find_pandoc() -> Result<PathBuf, String> {
    // Try PATH first
    if let Ok(path) = which::which("pandoc") {
        return Ok(path);
    }

    // Check common installation locations
    #[cfg(target_os = "macos")]
    {
        let candidates = [
            "/usr/local/bin/pandoc",
            "/opt/homebrew/bin/pandoc",
            "/Applications/pandoc.app/Contents/MacOS/pandoc",
        ];
        for p in &candidates {
            let path = PathBuf::from(p);
            if path.exists() {
                return Ok(path);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files\Pandoc\pandoc.exe",
            r"C:\Users\{}\AppData\Local\Pandoc\pandoc.exe",
        ];
        for p in &candidates {
            let path = if p.contains("{}") {
                if let Some(home) = std::env::var("USERPROFILE").ok() {
                    PathBuf::from(p.replace("{}", &home))
                } else {
                    continue;
                }
            } else {
                PathBuf::from(p)
            };
            if path.exists() {
                return Ok(path);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let candidates = ["/usr/bin/pandoc", "/usr/local/bin/pandoc"];
        for p in &candidates {
            let path = PathBuf::from(p);
            if path.exists() {
                return Ok(path);
            }
        }
    }

    Err("pandoc not found. Install pandoc to export Markdown as PDF.".to_string())
}

/// Compile a Markdown file to PDF using pandoc with XeLaTeX engine.
///
/// Uses XeLaTeX for proper CJK font support. The generated PDF bytes are returned.
#[tauri::command]
pub async fn compile_markdown_to_pdf(
    work_dir: String,
    md_file: String,
) -> Result<Vec<u8>, String> {
    let pandoc_path = find_pandoc()?;

    let md_path = PathBuf::from(&work_dir).join(&md_file);
    if !md_path.exists() {
        return Err(format!("Markdown file not found: {}", md_file));
    }

    // Generate output path in temp directory
    let temp_dir = std::env::temp_dir();
    let output_stem = md_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let output_pdf = temp_dir.join(format!("{}.pdf", output_stem));

    // Build pandoc command
    // Use XeLaTeX engine for CJK support
    // Add CJK font settings via mainfont and CJKmainfont options
    let mut cmd = Command::new(&pandoc_path);
    cmd.args([
        &md_path.to_string_lossy(),
        "-o",
        &output_pdf.to_string_lossy(),
        "--pdf-engine=xelatex",
        "-V",
        "mainfont=Times New Roman",
        "-V",
        "CJKmainfont=PingFang SC", // macOS CJK font
        "-V",
        "geometry:margin=1in",
    ]);

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
        // Use Windows-compatible CJK font
        cmd.args(["-V", "CJKmainfont=Microsoft YaHei"]);
    }

    #[cfg(target_os = "linux")]
    {
        // Use Linux-compatible CJK font
        cmd.args(["-V", "CJKmainfont=Noto Sans CJK SC"]);
    }

    cmd.current_dir(&work_dir);

    // Run pandoc
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run pandoc: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "Pandoc failed:\n{}\n{}",
            stderr.trim(),
            stdout.trim()
        ));
    }

    // Read generated PDF
    let pdf_bytes = std::fs::read(&output_pdf)
        .map_err(|e| format!("Failed to read generated PDF: {}", e))?;

    // Cleanup temp file
    let _ = std::fs::remove_file(&output_pdf);

    Ok(pdf_bytes)
}
