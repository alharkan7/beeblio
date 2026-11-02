---
name: latex
description: "Compile saved LaTeX project files to PDF and diagnose LaTeX build errors using the local compile tool."
---

# LaTeX compilation

When a user asks to compile a saved `.tex` project file, call `compile_latex` with its absolute `/workspace/...` path. The tool runs the same compiler as the editor's Compile button and writes a deterministic PDF under `/workspace/4-Reports/Compiled/`, preserving the source's relative path. A successful recompile updates that PDF. If compilation fails, inspect the returned file and line diagnostics, fix the source or a referenced project file when authorized, and retry. Do not claim a PDF exists unless the tool succeeds. The editor's reading preview is not a compiler.
