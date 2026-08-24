# ChemEdit

**Bring chemistry to Obsidian.** 

ChemEdit is a fully-integrated chemical structure editor and viewer. Powered by **Ketcher** and **SmilesDrawer**, it allows you to natively draw reactions, edit `.mol` files, preview ChemDraw (`.cdxml`) files directly inside your vault, and keep simple electronic lab notebooks (ELNs).

### Quick Demo


<img width="800" height="874" alt="chemedit demo new" src="https://github.com/user-attachments/assets/9d282240-cb11-434c-a60f-466b912d9b04" />


#### ELN Quick Demo


<img width="800" height="900" alt="ELNquckdemo-ezgif com-optimize" src="https://github.com/user-attachments/assets/5a4a6d77-9652-4501-8ce9-5ff0cb226953" />



### 🚀 What's New in ChemEdit
- **Interactive ELN Editor:** Added a floating action bar to ELN blocks. You can now visually edit Reactants, Products, Equivalents, and Procedures via a clean UI without touching Markdown YAML!
- **🧪 Auto-Name Structures:** Added a smart "Auto-Name" button inside the ELN editor that automatically fetches IUPAC/Common names for your drawn structures via PubChem/CACTUS.
- **📸 Fume Hood Utilities (Media Ribbon):** Take Lab Photos or upload TLC plates directly into your notes. 
- **Stoichiometry Engine:** Reagents are now fully synced. Set a **⭐ Limiting Reagent**, change its mass, and watch every other chemical scale automatically. 
- **Concentration Support:** Define reagents by `Purity (%)` or `Molarity (M)`. Volumes (mL) and active masses are calculated instantly.

**⚡ Custom Macros & Media**
- **Smart Attachment Sync:** Added a custom **Flask** ribbon icon (optional in settings). Creating a new experiment saves it in your default ELN directory. Click `Photo` or `TLC` inside the experiment, and the image is auto-prefixed with your experiment code (e.g. `EXP-005_TLC_1204.png`) and smart-pasted directly into the *Analytical Data* section.
- **Clone Experiment:** Instantly duplicate a reaction to a new file. It clones the scheme but wipes the yields so you can run it again.
- **Macros Menu:** Instantly drop timestamps or boilerplate text (like aqueous workups and column chromatography procedures) into your markdown via the ⚡ Macros button.

**🖼️ Dynamic Galleries & Embeds**
- **Gallery Grids:** Type ````chem-gallery path: Folder/```` or ````eln-gallery path: Folder/```` to render beautiful, searchable grids of your structures and past experiments. 
<img width="855" height="431" alt="Image" src="https://github.com/user-attachments/assets/539ccf54-1978-47c1-9318-6bf4974eb03e" />

## 🚀 What's New in ChemEdit 1.3.2

### ChemEdit now supports viewing and editing biological sequences via Ketcher's macromolecule mode.
-   **Explanation:** Native codeblock and file support for DNA, RNA, and Peptides.
-   **Examples:** You can now use ````fasta````, ````helm````, ````idt````, ````sequence````, and ````biln```` codeblocks. 
*(Note: Ketcher's biological parser is still in active upstream development, so highly complex sequences may fall back to default structural representations).*
### Ketcher SVGs support
SVGs that act as standard images but contain editable chemical data.
-   **Example:** `![[aspirin.svg]]` renders anywhere in your vault and can be open in other programs as normal svg. Right-click the file in Obsidian to see the new **"Edit SVG in Ketcher"** option.
<img width="667" height="573" alt="image" src="https://github.com/user-attachments/assets/a6df57a9-b372-488b-a08b-c502560a25ef" />
<img width="404" height="802" alt="image" src="https://github.com/user-attachments/assets/72716785-75ac-4172-9b36-5048e2b93a53" />
<img width="493" height="680" alt="image" src="https://github.com/user-attachments/assets/f66f5b70-d103-41ed-8a6c-75c50b7a4bc2" />


## ✨ Features

- **Native File Support:** Render and edit `.mol`, `.cdxml`, `.rxn`, and more directly via standard Obsidian embeds (`![[file.mol]]`).
- **Double-Click to Edit:** Click any rendered molecule to open the visual drawing interface.
- **Auto-Save:** Hit "Save" in the editor to instantly overwrite the file on your hard drive and update the preview.
- **Inline Molecules:** Render small molecules directly inside sentences using `$smiles=C1=CC=CC=C1`.
- **Smart Paste:** Paste SMILES or MOL text directly into the editor and let ChemEdit format it for you.
- **Smart Themes:** Structures automatically adapt to your Obsidian Light/Dark mode.
- **Reactions:** Full support for drawing and rendering complex chemical reactions.

---

## 🚀 How to Use

### 1. Native File Embeds (The Easy Way)
Drop a chemistry file into your vault and embed it in your note using Obsidian's standard syntax. ChemEdit will automatically replace the generic file box with a rendered image!

```markdown
![[caffeine.cdxml]]
![[aspirin.mol]]
![[reaction.rxn]]
```
**Double-click the image** to open Ketcher, edit the molecule, and save!

> ⚠️ **Disclaimer on `.cdxml` files:** ChemEdit uses Ketcher's open-source conversion engine. While most standard structures and reactions work perfectly, highly complex formatting or proprietary ChemDraw-specific objects may not be 100% supported.

### 2. SMILES Blocks
Write SMILES strings directly in your markdown using code blocks:

````markdown
```smiles
CC(=O)OC1=CC=CC=C1C(=O)O
```
````
*Double-click the structure to edit it visually. Saving will automatically update the text in your code block.*

### 3. Inline Molecules
You can render molecules directly inside a sentence. Perfect for chemical tables!
```markdown
The structure of Benzene is $smiles=C1=CC=CC=C1 and it is a liquid at room temp.
```

### 4. Draw from Scratch
Click the **Hexagon (cyclohexane) Icon** in your left-hand ribbon (or use the Command Palette: *Draw new SMILES molecule*) to open a blank canvas. Draw your structure, select your desired format, hit **Save**, and it will be inserted exactly where you are typing.

---

## 🧪 Electronic Lab Notebook (ELN)

ChemEdit includes an automatic stoichiometry calculator and experimental logbook generator. Using a simple YAML code block, you can define your reaction, and ChemEdit will:

- **Calculate stoichiometry** (moles, mass, volume).
- **Calculate theoretical yield** and percentage yield.

### ELN Usage

<video src="https://github.com/user-attachments/assets/f1ee4820-636d-44d1-846e-a286597670df" controls width="800"></video>

Create an `eln` code block and define your experiment:

````markdown
```eln
Code: RSA-007
title: Aspirin Synthesis
author: rsa
creation_date: Dec 16, 2018

duration: 20 min
solvent: none
temperature: 80 °C

reactants:
- name: Salicylic acid
  smiles: O=C(C1C(O)=CC=CC=1)O
  eq: 1
  mass: 1381

- name: Acetic anhydride
  smiles: CC(=O)OC(=O)C
  eq: 1.5
  density: 1.08

- name: Sulfuric acid (catalytic)
  smiles: OS(=O)(=O)O
  eq: 0.05
  density: 1.84

products:
- name: Aspirin
  smiles: CC(=O)OC1=CC=CC=C1C(=O)O
  eq: 1
  mass_isolated: 1600

procedure: |  
  Salicylic acid was mixed with acetic anhydride, followed by the addition of catalytic sulfuric acid. The reaction mixture was heated at 80 °C for 20 min, then cooled and poured into ice-water. The precipitated aspirin was collected by filtration, washed with cold water, and dried.
```
````


## 📥 Installation

**From Obsidian Community Plugins (Recommended)**

1. Open **Settings → Community plugins**.
2. Click **Browse** and search for **ChemEdit**.
3. Click **Install** and then **Enable**.

**Manual Installation**

1. Download `main.js` and `manifest.json` from the [Releases page](https://github.com/ruzx/obsidian-chemedit/releases).
2. Place them in your vault at `.obsidian/plugins/chemedit/`.
3. Reload plugins and enable ChemEdit.

## 🐛 Feedback & Bugs

Found a bug or have a feature request? Please [open an issue on GitHub](https://github.com/ruzx/obsidian-chemedit/issues). 

## 🏆 Acknowledgements

A massive thank you to the creators of the [Chem](https://github.com/Acylation/obsidian-chem) and [Ketcher](https://github.com/yuleicul/obsidian-ketcher) Obsidian plugins. Their fantastic work provided the initial inspiration to build this tool. ChemEdit was ultimately born out of a desire to create a dedicated Electronic Lab Notebook (ELN) experience in Obsidian—one that offers seamless, visual molecule editing and native, dynamic interactive support for SMILES, ChemDraw (`.cdxml`) and Mol (`.mol`) files.


- [Ketcher](https://github.com/epam/ketcher) by EPAM Systems
- [SmilesDrawer](https://github.com/reymond-group/smilesDrawer) by the Reymond Group

## 🔬 Related Chemistry Plugins

ChemEdit focuses on **interactive molecular drawing, editing, and visualization**. Depending on your workflow, you may also find these Obsidian plugins useful:

| Plugin                                                                                          | Description                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Chem](https://github.com/Acylation/obsidian-chem)                                              | Render **SMILES** structures locally using SmilesDrawer and RDKit.js. Great for fast inline visualization without requiring an external service. |
| [Ketcher](https://github.com/yuleicul/obsidian-ketcher)                                         | Embed the Ketcher molecule editor directly inside Obsidian to draw and edit molecules and reactions.                                             |
| [Chemical Structure Renderer](https://github.com/xaya1001/obsidian-chemical-structure-renderer) | Render **SMILES** structures using the Ketcher + Indigo rendering service. Supports SVG/PNG output and custom rendering servers.                 |
| [LaTeX Suite](https://github.com/artisticat1/obsidian-latex-suite)                              | Makes writing chemistry equations easier with LaTeX packages such as `mhchem` and `chemfig`.                                                     |
| [TikZJax](https://github.com/artisticat1/obsidian-tikzjax)                                      | Render TikZ diagrams directly inside Obsidian, including figures created with `chemfig`.                                                         |
| [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin)                           | Draw reaction mechanisms, synthesis schemes, and lecture notes by hand.                                                                          |

### Why ChemEdit?

ChemEdit combines features that would otherwise require several plugins:

- Interactive **Ketcher** editor.
- Native editing of **SMILES**, **MOL**, and **CDXML** files.
- Double-click editing directly from rendered structures.
- Automatic synchronization with files in your vault.
- Online and fully offline modes.
- Experimental Electronic Lab Notebook (ELN) with stoichiometry calculations.

---
