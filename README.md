# ChemEdit

An Obsidian plugin for displaying and editing chemical structures directly in your notes.

## Introduction

ChemEdit allows you to work with chemical structures in Obsidian using SMILES notation and an integrated chemical structure editor.

### How to use ChemEdit

<video src="https://github.com/user-attachments/assets/e215352a-7717-4c9a-bf95-c134b9a81ecd" controls width="800"></video>

## Installation

### From Obsidian Community Plugins

1. Open **Settings → Community plugins**.
2. Click **Browse**.
3. Search for **ChemEdit**.
4. Click **Install**.
5. Enable **ChemEdit**.

### Manual installation

1. Download the latest release from the [Releases](https://github.com/ruzx/obsidian-chemedit/releases) page.
2. Create the following folder in your Obsidian vault:

   `.obsidian/plugins/obsidian-chemedit/`

3. Copy the following into that folder:

   - `main.js`
   - `manifest.json`
   - `ketcher/`

4. Restart Obsidian or reload community plugins.
5. Enable **ChemEdit** in **Settings → Community plugins**.

## Enabling ChemEdit

After installing the plugin, open **Settings → Community plugins** and switch on **ChemEdit**.

<video src="https://github.com/user-attachments/assets/ae5f19cc-73b3-463a-acc2-36f79274fa88" controls width="800"></video>

## Features

- Display chemical structures from SMILES strings
- Edit chemical structures using an integrated structure editor
- Work with chemical structures directly inside Obsidian

## Development

Clone the repository:

```bash
git clone https://github.com/ruzx/obsidian-chemedit.git
cd obsidian-chemedit
````

Install dependencies:

```bash
npm install
```

Build the plugin:

```bash
npm run build
```

The compiled plugin is generated as `main.js`.

## Repository

Source code and releases:

[https://github.com/ruzx/obsidian-chemedit](https://github.com/ruzx/obsidian-chemedit)

## License

MIT
