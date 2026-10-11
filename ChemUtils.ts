// ChemUtils.ts
export function embedDataInSvg(svgStr: string, data: string, format: string): string {
    try {
        const base64Data = btoa(unescape(encodeURIComponent(data)));
        const injection = `\n<desc id="ketcher-data" data-format="${format}">${base64Data}</desc>\n`;
        if (svgStr.includes('id="ketcher-data"')) return svgStr.replace(/<desc id="ketcher-data"[^>]*>.*?<\/desc>/is, injection);
        return svgStr.replace(/(<svg[^>]*>)/i, `$1${injection}`);
    } catch (e) { return svgStr; }
}

export function extractDataFromSvg(svgStr: string): { format: string, data: string } | null {
    const match = svgStr.match(/<desc id="ketcher-data" data-format="([^"]+)">([\s\S]*?)<\/desc>/i);
    if (match) { 
        try { 
            return { format: match[1], data: decodeURIComponent(escape(atob(match[2].trim()))) }; 
        } catch (e) { 
            return null; 
        } 
    }
    return null;
}