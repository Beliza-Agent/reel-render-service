const express = require("express");
const { spawn } = require("child_process");
const { createCanvas, loadImage, registerFont } = require("canvas");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

const app = express();
app.use(express.json());

const TEMPLATE_PATH = path.join(__dirname, "assets", "template.png");
const SLIDE_TEMPLATE_PATH = path.join(__dirname, "assets", "slide-template.png"); // eigenes 4:5-Template fuer Karussell-Slides
const FONT_BOLD_PATH = path.join(__dirname, "assets", "Poppins-Bold.ttf");
const FONT_MEDIUM_PATH = path.join(__dirname, "assets", "Poppins-Medium.ttf");
registerFont(FONT_BOLD_PATH, { family: "Poppins-Bold" });
registerFont(FONT_MEDIUM_PATH, { family: "Poppins-Medium" });

const OUTPUT_W = 864;
const OUTPUT_H = 1536;
const ACCENT_COLOR = "rgb(190, 130, 88)";
const TEXT_COLOR = "rgb(20, 20, 20)";

// Karussell-Slides: eigenes Format (Instagram 4:5)
const SLIDE_W = 1080;
const SLIDE_H = 1350;

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download fehlgeschlagen (${res.statusCode}) fuer ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("ffmpeg-Fehler: " + stderr.slice(-2000)));
    });
  });
}

// NEU: zeichnet ein Bild "cover"-artig (wie CSS background-size: cover) statt es zu verzerren.
// Skaliert proportional und schneidet Ueberstand ab, damit das Seitenverhaeltnis erhalten bleibt.
function drawImageCover(ctx, img, targetW, targetH, anchor = "center") {
  const srcRatio = img.width / img.height;
  const targetRatio = targetW / targetH;
  let sx, sy, sw, sh;

  if (srcRatio > targetRatio) {
    // Quellbild breiter als Ziel -> links/rechts wird zugeschnitten
    sh = img.height;
    sw = sh * targetRatio;
    sx = anchor === "left" ? 0 : anchor === "right" ? img.width - sw : (img.width - sw) / 2;
    sy = 0;
  } else {
    // Quellbild hoeher/schmaler als Ziel -> oben/unten wird zugeschnitten
    sw = img.width;
    sh = sw / targetRatio;
    sx = 0;
    sy = anchor === "top" ? 0 : anchor === "bottom" ? img.height - sh : (img.height - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
}

// Zeichnet die Kopfzeilen-Headline auf die Vorlage und gibt einen PNG-Buffer zurueck
async function renderHeadlineImage(lines) {
  const template = await loadImage(TEMPLATE_PATH);
  const canvas = createCanvas(OUTPUT_W, OUTPUT_H);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(template, 0, 0, OUTPUT_W, OUTPUT_H);

  const marginX = Math.round(OUTPUT_W * 0.075);
  const maxTextWidth = OUTPUT_W - marginX * 2;
  let fontSize = Math.round(OUTPUT_W * 0.075);

  ctx.textBaseline = "top";

  const upperLines = lines.map((l) => l.replace(/ß/g, "SS").toUpperCase());
  let widest = maxTextWidth + 1;
  while (widest > maxTextWidth && fontSize > 18) {
    ctx.font = `${fontSize}px "Poppins-Medium"`;
    widest = Math.max(...upperLines.map((l) => ctx.measureText(l).width));
    if (widest > maxTextWidth) fontSize -= 3;
  }

  const lineGap = Math.round(fontSize * 1.15);
  let y = Math.round(OUTPUT_H * 0.30);

  ctx.strokeStyle = ACCENT_COLOR;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(Math.round(OUTPUT_W * 0.03), Math.round(OUTPUT_H * 0.24));
  ctx.lineTo(Math.round(OUTPUT_W * 0.03), Math.round(OUTPUT_H * 0.38));
  ctx.stroke();

  ctx.font = `${fontSize}px "Poppins-Medium"`;
  upperLines.forEach((line, i) => {
    ctx.fillStyle = i === upperLines.length - 1 ? ACCENT_COLOR : TEXT_COLOR;
    ctx.fillText(line, marginX, y + i * lineGap);
  });

  const underlineY = y + upperLines.length * lineGap + Math.round(OUTPUT_H * 0.015);
  ctx.beginPath();
  ctx.moveTo(marginX, underlineY);
  ctx.lineTo(marginX + Math.round(OUTPUT_W * 0.12), underlineY);
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// NEU: einfache Vektor-Icons in der Akzentfarbe, gezeichnet mit Grundformen (kein Bild-Asset noetig)
function drawIcon(ctx, iconName, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(3, size * 0.045);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const s = size;

  switch (iconName) {
    case "laptop": {
      ctx.strokeRect(x + s * 0.08, y + s * 0.12, s * 0.84, s * 0.55);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.02, y + s * 0.75);
      ctx.lineTo(x + s * 1.02, y + s * 0.75);
      ctx.lineTo(x + s * 0.9, y + s * 0.92);
      ctx.lineTo(x + s * 0.1, y + s * 0.92);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case "smartphone": {
      ctx.strokeRect(x + s * 0.28, y + s * 0.05, s * 0.44, s * 0.9);
      ctx.beginPath();
      ctx.arc(x + s * 0.5, y + s * 0.82, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "chart": {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.08, y + s * 0.92);
      ctx.lineTo(x + s * 0.08, y + s * 0.08);
      ctx.moveTo(x + s * 0.08, y + s * 0.92);
      ctx.lineTo(x + s * 0.95, y + s * 0.92);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.2, y + s * 0.7);
      ctx.lineTo(x + s * 0.42, y + s * 0.5);
      ctx.lineTo(x + s * 0.6, y + s * 0.62);
      ctx.lineTo(x + s * 0.88, y + s * 0.25);
      ctx.stroke();
      break;
    }
    case "gear": {
      const cx = x + s * 0.5, cy = y + s * 0.5, r = s * 0.28;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rOuter = r * 1.5;
        ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * rOuter, cy + Math.sin(a) * rOuter);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "chat": {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.15, y + s * 0.15);
      ctx.lineTo(x + s * 0.85, y + s * 0.15);
      ctx.quadraticCurveTo(x + s * 0.95, y + s * 0.15, x + s * 0.95, y + s * 0.25);
      ctx.lineTo(x + s * 0.95, y + s * 0.6);
      ctx.quadraticCurveTo(x + s * 0.95, y + s * 0.7, x + s * 0.85, y + s * 0.7);
      ctx.lineTo(x + s * 0.35, y + s * 0.7);
      ctx.lineTo(x + s * 0.2, y + s * 0.92);
      ctx.lineTo(x + s * 0.25, y + s * 0.7);
      ctx.lineTo(x + s * 0.15, y + s * 0.7);
      ctx.quadraticCurveTo(x + s * 0.05, y + s * 0.7, x + s * 0.05, y + s * 0.6);
      ctx.lineTo(x + s * 0.05, y + s * 0.25);
      ctx.quadraticCurveTo(x + s * 0.05, y + s * 0.15, x + s * 0.15, y + s * 0.15);
      ctx.stroke();
      break;
    }
    case "lightbulb": {
      const cx = x + s * 0.5, cy = y + s * 0.38, r = s * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.4, cy + r * 0.85);
      ctx.lineTo(cx + r * 0.4, cy + r * 0.85);
      ctx.moveTo(cx - r * 0.35, y + s * 0.85);
      ctx.lineTo(cx + r * 0.35, y + s * 0.85);
      ctx.stroke();
      break;
    }
    case "checklist": {
      for (let i = 0; i < 3; i++) {
        const yy = y + s * (0.15 + i * 0.3);
        ctx.strokeRect(x + s * 0.05, yy, s * 0.18, s * 0.18);
        ctx.beginPath();
        ctx.moveTo(x + s * 0.32, yy + s * 0.09);
        ctx.lineTo(x + s * 0.95, yy + s * 0.09);
        ctx.stroke();
      }
      break;
    }
    case "calendar": {
      ctx.strokeRect(x + s * 0.08, y + s * 0.15, s * 0.84, s * 0.75);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.08, y + s * 0.38);
      ctx.lineTo(x + s * 0.92, y + s * 0.38);
      ctx.moveTo(x + s * 0.28, y + s * 0.05);
      ctx.lineTo(x + s * 0.28, y + s * 0.22);
      ctx.moveTo(x + s * 0.72, y + s * 0.05);
      ctx.lineTo(x + s * 0.72, y + s * 0.22);
      ctx.stroke();
      break;
    }
    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.1, y + s * 0.5);
      ctx.lineTo(x + s * 0.85, y + s * 0.5);
      ctx.moveTo(x + s * 0.6, y + s * 0.25);
      ctx.lineTo(x + s * 0.9, y + s * 0.5);
      ctx.lineTo(x + s * 0.6, y + s * 0.75);
      ctx.stroke();
      break;
    }
    case "shield": {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.05);
      ctx.lineTo(x + s * 0.9, y + s * 0.2);
      ctx.lineTo(x + s * 0.9, y + s * 0.55);
      ctx.quadraticCurveTo(x + s * 0.9, y + s * 0.85, x + s * 0.5, y + s * 0.98);
      ctx.quadraticCurveTo(x + s * 0.1, y + s * 0.85, x + s * 0.1, y + s * 0.55);
      ctx.lineTo(x + s * 0.1, y + s * 0.2);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    default:
      break;
  }

  ctx.restore();
}

// Zeichnet eine Karussell-Slide (Icon + Ueberschrift + Fliesstext) auf die bestehende Vorlage.
// Headline-Stil ist bewusst identisch zur Reel-Headline (renderHeadlineImage): gleiche Schriftgroessen-Logik,
// gleiche Schriftart (Poppins-Medium), letzte Zeile in Akzentfarbe, Akzent-Strich darueber, Unterstreichung darunter.
async function renderSlideImage({ ueberschrift, text, nummer, gesamt, icon }) {
  const template = await loadImage(SLIDE_TEMPLATE_PATH);
  const canvas = createCanvas(SLIDE_W, SLIDE_H);
  const ctx = canvas.getContext("2d");

  // Eigenes Slide-Template hat bereits das richtige 4:5-Format -> einfaches Draw reicht, kein Zuschnitt noetig
  ctx.drawImage(template, 0, 0, SLIDE_W, SLIDE_H);

  const marginX = Math.round(SLIDE_W * 0.075);
  const maxTextWidth = SLIDE_W - marginX * 2;
  ctx.textBaseline = "top";

  // Icon: klein, oberhalb des Akzent-Strichs, tritt hinter die Headline zurueck
  if (icon && icon !== "none") {
    const iconSize = Math.round(SLIDE_W * 0.075);
    const iconY = Math.round(SLIDE_H * 0.12);
    drawIcon(ctx, icon, marginX, iconY, iconSize, ACCENT_COLOR);
  }

  // Akzent-Strich (wie beim Reel)
  ctx.strokeStyle = ACCENT_COLOR;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(marginX, Math.round(SLIDE_H * 0.235));
  ctx.lineTo(marginX, Math.round(SLIDE_H * 0.265));
  ctx.stroke();

  // Headline: gleiche Groessen-/Schrumpf-Logik wie beim Reel (renderHeadlineImage)
  const upperLines = ueberschrift.replace(/ß/g, "SS").toUpperCase();
  let headlineFontSize = Math.round(SLIDE_W * 0.072);
  let headlineLines = [];
  let widest = maxTextWidth + 1;

  while (headlineFontSize > 22) {
    ctx.font = `${headlineFontSize}px "Poppins-Medium"`;
    headlineLines = wrapText(ctx, upperLines, maxTextWidth);
    widest = Math.max(...headlineLines.map((l) => ctx.measureText(l).width));
    if (widest <= maxTextWidth && headlineLines.length <= 4) break;
    headlineFontSize -= 3;
  }

  const headlineLineGap = Math.round(headlineFontSize * 1.15);
  let y = Math.round(SLIDE_H * 0.30);

  ctx.font = `${headlineFontSize}px "Poppins-Medium"`;
  headlineLines.forEach((line, i) => {
    ctx.fillStyle = i === headlineLines.length - 1 ? ACCENT_COLOR : TEXT_COLOR;
    ctx.fillText(line, marginX, y + i * headlineLineGap);
  });

  // Unterstreichung (wie beim Reel)
  const underlineY = y + headlineLines.length * headlineLineGap + Math.round(SLIDE_H * 0.02);
  ctx.strokeStyle = ACCENT_COLOR;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(marginX, underlineY);
  ctx.lineTo(marginX + Math.round(SLIDE_W * 0.12), underlineY);
  ctx.stroke();

  y = underlineY + Math.round(SLIDE_H * 0.04);

  // Fliesstext
  const maxBodyBottom = Math.round(SLIDE_H * 0.92);
  const availableHeight = maxBodyBottom - y;
  let bodyFontSize = Math.round(SLIDE_W * 0.034);
  let bodyLines = [];
  let bodyLineGap = 0;

  do {
    ctx.font = `${bodyFontSize}px "Poppins-Medium"`;
    bodyLines = wrapText(ctx, text, maxTextWidth);
    bodyLineGap = Math.round(bodyFontSize * 1.45);
    if (bodyLines.length * bodyLineGap > availableHeight) bodyFontSize -= 1;
  } while (bodyLines.length * bodyLineGap > availableHeight && bodyFontSize > 16);

  ctx.fillStyle = TEXT_COLOR;
  bodyLines.forEach((line, i) => {
    ctx.fillText(line, marginX, y + i * bodyLineGap);
  });

  return canvas.toBuffer("image/png");
}

app.get("/", (req, res) => {
  res.send("Reel-Render-Dienst laeuft. POST /render-reel mit { headline_lines, audio_url }. POST /render-slide mit { ueberschrift, text, nummer, gesamt, icon }.");
});

app.post("/render-reel", async (req, res) => {
  const { headline_lines, audio_url, duration_seconds, music_volume } = req.body || {};

  if (!headline_lines || !Array.isArray(headline_lines) || !headline_lines.length) {
    return res.status(400).json({ error: "headline_lines (Array von 1-3 Zeilen) ist erforderlich" });
  }
  if (!audio_url) {
    return res.status(400).json({ error: "audio_url ist erforderlich" });
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
  const imagePath = path.join(workDir, "headline.png");
  const audioPath = path.join(workDir, "input_audio.mp3");
  const outputPath = path.join(workDir, "output_" + crypto.randomBytes(4).toString("hex") + ".mp4");

  try {
    const buffer = await renderHeadlineImage(headline_lines.slice(0, 3));
    fs.writeFileSync(imagePath, buffer);

    await download(audio_url, audioPath);

    const duration = duration_seconds || 10;
    const volume = typeof music_volume === "number" ? music_volume : 0.8;

    const args = [
      "-y",
      "-loop", "1",
      "-i", imagePath,
      "-stream_loop", "-1",
      "-i", audioPath,
      "-filter:a", `volume=${volume}`,
      "-t", String(duration),
      "-vf", `scale=${OUTPUT_W}:${OUTPUT_H}`,
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-c:a", "aac",
      "-b:a", "128k",
      "-shortest",
      outputPath,
    ];

    await runFfmpeg(args);

    res.setHeader("Content-Type", "video/mp4");
    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on("close", () => {
      fs.rmSync(workDir, { recursive: true, force: true });
    });
  } catch (err) {
    fs.rmSync(workDir, { recursive: true, force: true });
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/render-slide", async (req, res) => {
  const { ueberschrift, text, nummer, gesamt, icon } = req.body || {};

  if (!ueberschrift || !text) {
    return res.status(400).json({ error: "ueberschrift und text sind erforderlich" });
  }

  try {
    const buffer = await renderSlideImage({ ueberschrift, text, nummer, gesamt, icon });
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Render-Dienst laeuft auf Port " + PORT));
