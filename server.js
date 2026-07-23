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
const FONT_PATH = path.join(__dirname, "assets", "Poppins-Bold.ttf");
registerFont(FONT_PATH, { family: "Poppins-Bold" });

const OUTPUT_W = 720;
const OUTPUT_H = 1280;
const ACCENT_COLOR = "rgb(190, 130, 88)";
const TEXT_COLOR = "rgb(20, 20, 20)";

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
  const fontSize = Math.round(OUTPUT_W * 0.105);
  const lineGap = Math.round(fontSize * 1.12);
  let y = Math.round(OUTPUT_H * 0.30);

  ctx.textBaseline = "top";
  ctx.font = `${fontSize}px "Poppins-Bold"`;

  ctx.strokeStyle = ACCENT_COLOR;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(Math.round(OUTPUT_W * 0.03), Math.round(OUTPUT_H * 0.24));
  ctx.lineTo(Math.round(OUTPUT_W * 0.03), Math.round(OUTPUT_H * 0.38));
  ctx.stroke();

  lines.forEach((line, i) => {
    ctx.fillStyle = i === lines.length - 1 ? ACCENT_COLOR : TEXT_COLOR;
    ctx.fillText(line.toUpperCase(), marginX, y + i * lineGap);
  });

  const underlineY = y + lines.length * lineGap + Math.round(OUTPUT_H * 0.015);
  ctx.beginPath();
  ctx.moveTo(marginX, underlineY);
  ctx.lineTo(marginX + Math.round(OUTPUT_W * 0.12), underlineY);
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

app.get("/", (req, res) => {
  res.send("Reel-Render-Dienst laeuft. POST /render-reel mit { headline_lines, audio_url }.");
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
      "-preset", "veryfast",
      "-crf", "28",
      "-c:a", "aac",
      "-b:a", "96k",
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Render-Dienst laeuft auf Port " + PORT));
