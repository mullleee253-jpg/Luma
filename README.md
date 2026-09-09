# Luma Archive

Native lossless byte-stream archiver in C++20.

The program reads files as binary bytes, compares RLE and canonical Huffman representations, stores the smallest one, and verifies the result with CRC32. It restores the exact original byte sequence. If compression would make a file larger, it stores the original bytes instead of pretending that compression happened.

## Build on Windows

Open a **Developer Command Prompt for Visual Studio**:

```bat
cl /std:c++20 /O2 /W4 /EHsc /Fe:luma-archive.exe native\main.cpp
```

Or use CMake when it is installed:

```bat
cmake -S . -B build
cmake --build build --config Release
```

## Use

```bat
luma-archive.exe pack photo.bin photo.luma
luma-archive.exe unpack photo.luma photo-restored.bin
```

The unpack command verifies the archive CRC32. RLE can exceed 600x on data with long repeated byte runs; a 600x lossless ratio cannot be guaranteed for arbitrary files because already compressed data and random bytes contain no removable redundancy. The tool reports the real ratio and never changes the original bytes.

The included `luma-archive.exe` is a 64-bit Windows build.

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
