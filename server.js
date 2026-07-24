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
const FONT_BOLD_PATH = path.join(__dirname, "assets", "Poppins-Bold.ttf");
const FONT_MEDIUM_PATH = path.join(__dirname, "assets", "Poppins-Medium.ttf");
registerFont(FONT_BOLD_PATH, { family: "Poppins-Bold" });
registerFont(FONT_MEDIUM_PATH, { family: "Poppins-Medium" });

const OUTPUT_W = 864;
const OUTPUT_H = 1536;
const ACCENT_COLOR = "rgb(190, 130, 88)";
const TEXT_COLOR = "rgb(20, 20, 20)";

// NEU: eigene Masse fuer Karussell-Slides (Instagram-Format 4:5)
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

  // Schriftgroesse so lange verkleinern, bis die laengste Zeile sicher hineinpasst
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

// NEU: bricht einen Text an Wortgrenzen um, sodass jede Zeile in maxWidth passt
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

// NEU: zeichnet eine Karussell-Slide (Ueberschrift + Fliesstext) auf die bestehende Vorlage
async function renderSlideImage({ ueberschrift, text, nummer, gesamt }) {
  const template = await loadImage(TEMPLATE_PATH);
  const canvas = createCanvas(SLIDE_W, SLIDE_H);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(template, 0, 0, SLIDE_W, SLIDE_H);

  const marginX = Math.round(SLIDE_W * 0.09);
  const maxTextWidth = SLIDE_W - marginX * 2;
  ctx.textBaseline = "top";

  // Slide-Zaehler oben rechts (z. B. "3/10")
  if (nummer && gesamt) {
    ctx.font = `${Math.round(SLIDE_W * 0.032)}px "Poppins-Medium"`;
    ctx.fillStyle = ACCENT_COLOR;
    const counterText = `${nummer}/${gesamt}`;
    const counterWidth = ctx.measureText(counterText).width;
    ctx.fillText(counterText, SLIDE_W - marginX - counterWidth, Math.round(SLIDE_H * 0.05));
  }

  // Akzent-Strich links, wie beim Reel-Template
  ctx.strokeStyle = ACCENT_COLOR;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(Math.round(SLIDE_W * 0.03), Math.round(SLIDE_H * 0.12));
  ctx.lineTo(Math.round(SLIDE_W * 0.03), Math.round(SLIDE_H * 0.19));
  ctx.stroke();

  // Ueberschrift: Schriftgroesse verkleinern, bis max. 4 Zeilen passen
  let headlineFontSize = Math.round(SLIDE_W * 0.058);
  let headlineLines = [];
  do {
    ctx.font = `${headlineFontSize}px "Poppins-Bold"`;
    headlineLines = wrapText(ctx, ueberschrift.toUpperCase(), maxTextWidth);
    if (headlineLines.length > 4) headlineFontSize -= 2;
  } while (headlineLines.length > 4 && headlineFontSize > 24);

  const headlineLineGap = Math.round(headlineFontSize * 1.2);
  let y = Math.round(SLIDE_H * 0.15);

  ctx.fillStyle = TEXT_COLOR;
  headlineLines.forEach((line, i) => {
    ctx.fillText(line, marginX, y + i * headlineLineGap);
  });

  y += headlineLines.length * headlineLineGap + Math.round(SLIDE_H * 0.035);

  // Fliesstext: Schriftgroesse verkleinern, bis er in den verbleibenden Platz passt
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

  // Kleines Branding unten
  ctx.font = `${Math.round(SLIDE_W * 0.026)}px "Poppins-Medium"`;
  ctx.fillStyle = ACCENT_COLOR;
  ctx.fillText("BELIZA AGENTICS", marginX, Math.round(SLIDE_H * 0.955));

  return canvas.toBuffer("image/png");
}

app.get("/", (req, res) => {
  res.send("Reel-Render-Dienst laeuft. POST /render-reel mit { headline_lines, audio_url }. POST /render-slide mit { ueberschrift, text, nummer, gesamt }.");
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

// NEU: Endpoint fuer einzelne Karussell-Slides (statisches PNG, kein Audio/Video)
app.post("/render-slide", async (req, res) => {
  const { ueberschrift, text, nummer, gesamt } = req.body || {};

  if (!ueberschrift || !text) {
    return res.status(400).json({ error: "ueberschrift und text sind erforderlich" });
  }

  try {
    const buffer = await renderSlideImage({ ueberschrift, text, nummer, gesamt });
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Render-Dienst laeuft auf Port " + PORT));
