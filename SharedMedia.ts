// SharedMedia.ts
import { App, Modal, Notice, Platform } from 'obsidian';

export async function saveMediaFile(app: App, arrayBuffer: ArrayBuffer, savePath: string, filename: string): Promise<string> {
    let path = savePath;
    if (path === "/") path = "";
    if (path && !path.endsWith("/")) path += "/";
    const fullPath = `${path}${filename}`;

    if (path) {
        const folderExists = app.vault.getAbstractFileByPath(path.slice(0,-1));
        if (!folderExists) await app.vault.createFolder(path.slice(0,-1));
    }
    await app.vault.createBinary(fullPath, arrayBuffer);
    return fullPath;
}

export function takeStandardPhoto(callback: (buffer: ArrayBuffer, ext: string) => void) {
    const input = document.createElement('input');
    input.type = 'file'; 
    input.accept = 'image/*'; 
    input.capture = 'environment'; // Triggers native camera on mobile
    input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return;
        const buffer = await file.arrayBuffer();
        const ext = file.type.split('/')[1] || 'jpeg';
        callback(buffer, ext);
    };
    input.click();
}

export class TlcModal extends Modal {
    onSave: (pngData: ArrayBuffer, rfData: any[]) => void;
    canvas: HTMLCanvasElement; 
    ctx: CanvasRenderingContext2D; 
    img: HTMLImageElement | null = null;
    
    baselineY: number = 0; 
    frontY: number = 0;
    spots: {x: number, y: number, rf: number}[] = [];
    draggingTarget: string | number | null = null;

    constructor(app: App, onSave: (pngData: ArrayBuffer, rfData: any[]) => void) {
        super(app);
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this; 
        contentEl.empty();
        
        if (Platform.isMobile) { 
            this.modalEl.style.width = "100vw"; 
            this.modalEl.style.height = "100vh"; 
        }

        contentEl.createEl("h3", { text: "Digital TLC Calculator", attr: { style: "margin-top: 0; margin-bottom: 10px;" } });
        
        // Compact buttons for mobile
        const controls = contentEl.createDiv({ attr: {style: "margin-bottom: 15px; display: flex; gap: 8px; align-items:center;"}});
        
        const fileInput = controls.createEl("input", { type: "file", attr: { accept: "image/*", capture: "environment", style: "display:none;" }});
        const uploadBtn = controls.createEl("button", { text: "📷 Upload", cls: "mod-cta", attr: {style: "padding: 4px 12px;"} });
        uploadBtn.onclick = () => fileInput.click();
        
        const clearBtn = controls.createEl("button", { text: "Clear", attr: {style: "padding: 4px 12px;"} });
        clearBtn.onclick = () => { this.spots = []; this.draw(); };

        const saveBtn = controls.createEl("button", { text: "Save", cls: "mod-cta", attr: {style:"margin-left:auto; padding: 4px 16px;"} });
        saveBtn.style.display = "none";
        saveBtn.onclick = () => this.exportAndSave();

        const instructions = contentEl.createDiv({ cls: "color-text-muted", attr: {style: "font-size:12px; margin-bottom:10px; line-height: 1.3;"}});
        instructions.innerHTML = "Upload an image. Drag the <b style='color:#4488ff'>Baseline</b> and <b style='color:#ff4444'>Solvent Front</b>. Click anywhere to add a spot.";

        const canvasWrapper = contentEl.createDiv({ attr: {style: "width:100%; height:65vh; overflow:hidden; position:relative; background:#1e1e1e; border-radius:8px;"}});
        
        this.canvas = canvasWrapper.createEl("canvas");
        this.canvas.style.width = "100%"; 
        this.canvas.style.height = "100%";
        this.canvas.style.objectFit = "contain"; 
        this.canvas.style.touchAction = "none"; // Required for dragging on mobile
        this.ctx = this.canvas.getContext("2d")!;

        fileInput.onchange = (e: any) => {
            const file = e.target.files[0]; 
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                this.img = new Image();
                this.img.onload = () => {
                    // Downscale massively large phone photos (e.g. 4000x3000) to max 1600px to prevent memory crashes and make drawing consistent
                    let w = this.img!.width;
                    let h = this.img!.height;
                    const MAX_DIM = 1600;
                    if (w > MAX_DIM || h > MAX_DIM) {
                        const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
                        w = w * ratio;
                        h = h * ratio;
                    }
                    this.canvas.width = w; 
                    this.canvas.height = h;
                    
                    this.baselineY = this.canvas.height * 0.85; 
                    this.frontY = this.canvas.height * 0.15;
                    this.spots = []; 
                    saveBtn.style.display = "block"; 
                    this.draw();
                };
                this.img.src = event.target?.result as string;
            };
            reader.readAsDataURL(file);
        };
        this.setupInteractions();
    }

    setupInteractions() {
        const getCoords = (e: PointerEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            // Calculates exact pixel clicked based on object-fit: contain scaling
            const scale = Math.min(rect.width / this.canvas.width, rect.height / this.canvas.height);
            const x = (e.clientX - rect.left - (rect.width - this.canvas.width * scale) / 2) / scale;
            const y = (e.clientY - rect.top - (rect.height - this.canvas.height * scale) / 2) / scale;
            return { x, y };
        };

        this.canvas.addEventListener("pointerdown", (e) => {
            if (!this.img) return; 
            e.preventDefault(); 
            const { x, y } = getCoords(e);
            
            // Dynamic hit radius based on canvas size (fat-finger friendly for mobile!)
            const hitRadius = Math.max(50, this.canvas.width / 15); 

            // Check Spots
            for (let i = 0; i < this.spots.length; i++) {
                if (Math.hypot(this.spots[i].x - x, this.spots[i].y - y) < hitRadius) { this.draggingTarget = i; return; }
            }
            // Check Lines
            if (Math.abs(this.baselineY - y) < hitRadius) { this.draggingTarget = "baseline"; return; }
            if (Math.abs(this.frontY - y) < hitRadius) { this.draggingTarget = "front"; return; }
            
            // If missed everything, create a new spot
            this.spots.push({ x, y, rf: this.calcRf(y) });
            this.draggingTarget = this.spots.length - 1; 
            this.draw();
        });

        this.canvas.addEventListener("pointermove", (e) => {
            if (this.draggingTarget === null || !this.img) return;
            e.preventDefault(); 
            const { x, y } = getCoords(e);
            
            if (this.draggingTarget === "baseline") this.baselineY = y;
            else if (this.draggingTarget === "front") this.frontY = y;
            else if (typeof this.draggingTarget === "number") { this.spots[this.draggingTarget].x = x; this.spots[this.draggingTarget].y = y; }
            
            this.recalcSpots(); 
            this.draw();
        });

        this.canvas.addEventListener("pointerup", () => this.draggingTarget = null);
        this.canvas.addEventListener("pointercancel", () => this.draggingTarget = null);
    }

    calcRf(spotY: number) { return Math.max(0, Math.min(1, (this.baselineY - spotY) / (this.baselineY - this.frontY))); }
    
    recalcSpots() { this.spots.forEach(s => s.rf = this.calcRf(s.y)); }

    draw() {
        if (!this.img) return;
        const w = this.canvas.width; 
        const h = this.canvas.height;
        this.ctx.clearRect(0, 0, w, h); 
        this.ctx.drawImage(this.img, 0, 0, w, h);

        // Scale strokes and fonts perfectly dynamically relative to image resolution
        const scale = w / 800; 
        const lineW = Math.max(4, 6 * scale);
        const fontSz = Math.max(20, 28 * scale);
        const spotR = Math.max(15, 20 * scale);

        const drawLine = (y: number, color: string, label: string) => {
            this.ctx.beginPath(); 
            this.ctx.moveTo(0, y); 
            this.ctx.lineTo(w, y);
            this.ctx.strokeStyle = color; 
            this.ctx.lineWidth = lineW;
            this.ctx.setLineDash([20 * scale, 15 * scale]); 
            this.ctx.stroke(); 
            this.ctx.setLineDash([]);
            this.ctx.fillStyle = color; 
            this.ctx.font = `bold ${fontSz}px Arial`; 
            this.ctx.fillText(label, 20 * scale, y - (10 * scale));
        };

        drawLine(this.frontY, "#ff4444", "Solvent Front"); 
        drawLine(this.baselineY, "#4488ff", "Baseline");

        this.spots.forEach((s, i) => {
            this.ctx.beginPath(); 
            this.ctx.arc(s.x, s.y, spotR, 0, 2 * Math.PI);
            this.ctx.fillStyle = "rgba(0,255,0,0.5)"; 
            this.ctx.fill();
            this.ctx.strokeStyle = "#00ff00"; 
            this.ctx.lineWidth = Math.max(3, 4 * scale); 
            this.ctx.stroke();
            this.ctx.fillStyle = "white"; 
            this.ctx.font = `bold ${fontSz}px Arial`;
            this.ctx.shadowColor = "black"; 
            this.ctx.shadowBlur = 6 * scale;
            this.ctx.fillText(`${i+1} (Rf: ${s.rf.toFixed(2)})`, s.x + spotR + (10 * scale), s.y + (10 * scale));
            this.ctx.shadowBlur = 0; // reset
        });
    }

    exportAndSave() {
        if (!this.img) return;
        this.canvas.toBlob((blob) => {
            if (!blob) return; 
            const reader = new FileReader();
            reader.onload = () => { 
                this.onSave(reader.result as ArrayBuffer, this.spots); 
                this.close(); 
            };
            reader.readAsArrayBuffer(blob);
        }, "image/png");
    }

    onClose() { this.contentEl.empty(); }
}