"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDropzone } from "react-dropzone";
import axios from "axios";

/* -------------------------------- helpers -------------------------------- */

function log(...args) {
  console.log("[b2b-demo]", ...args);
}

// Probe your proxy: /api/cf-probe?key=... (returns {success, mastered, urls:[]})
async function probeCloudFront(s3Key, { setStatus, onFound }) {
  try {
    if (!s3Key) return false;
    const res = await fetch(
      `/api/cf-probe?key=${encodeURIComponent(s3Key)}&ext=mp3,wav,m4a,flac`,
      { cache: "no-store" }
    );
    if (!res.ok) return false;

    const data = await res.json();
    // clean encoded braces + de-dupe
    const cleaned = (data.urls || [])
      .filter(Boolean)
      .filter((u) => !/%7B|%7D|{|}/i.test(u));
    const uniq = [...new Set(cleaned)];

    if (data.mastered && uniq.length) {
      onFound(uniq);
      setStatus("Mastered files ready.");
      return true;
    }
  } catch (e) {
    log("probeCloudFront error:", e);
  }
  return false;
}

// Cancelable CF poller with heartbeat
function makeCfPoller({
  s3Key,
  setStatus,
  onFound,
  intervalMs = 3000,
  maxMs = 12 * 60 * 1000,
}) {
  let canceled = false;
  const start = Date.now();

  async function tick() {
    if (canceled) return;
    try {
      const ok = await probeCloudFront(s3Key, { setStatus, onFound });
      if (ok || canceled) return;
      const elapsed = Math.round((Date.now() - start) / 1000);
      setStatus(`Watching CloudFront… (${elapsed}s)`);
      if (Date.now() - start >= maxMs) {
        setStatus(
          "Still processing. Check pipeline paths & CloudFront origin."
        );
        return;
      }
    } catch (e) {
      log("cfPoller tick error:", e);
    }
    setTimeout(tick, intervalMs);
  }

  setTimeout(tick, 0);
  return () => {
    canceled = true;
  };
}

function buildVariantsFrom(url) {
  // supports .../v3.ext or ..._v3.ext
  const m = url.match(/(?:\/|_)v(\d+)\.(mp3|wav|m4a|flac)$/i);
  if (!m) return [url];
  const ext = m[2];
  const base = url.replace(/(?:\/|_)v\d+\.(mp3|wav|m4a|flac)$/i, "");
  return Array.from({ length: 5 }, (_, i) => `${base}_v${i + 1}.${ext}`);
}

// Parent poller factory — pass a jobId; calls onDone(url, payload) when mastered
function makeParentPoller({ jobId, setStatus, onDone }) {
  return () => {
    let canceled = false;
    const controller = new AbortController();

    async function tick() {
      if (canceled) return;
      try {
        const r = await fetch(`/api/mastering/${jobId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(await r.text());
        const d = await r.json();
        log("[parent poll payload]", d);

        // surface expectedKey/expectedUrl/deliverables while we wait
        if (d?.expectedKey) log("expectedKey:", d.expectedKey);
        if (d?.expectedUrl) log("expectedUrl:", d.expectedUrl);
        if (Array.isArray(d?.deliverables))
          log("deliverables:", d.deliverables);

        setStatus(
          `Status: ${d.mastered ? "mastered" : "processing"}${
            d.error ? ` (error: ${d.error})` : ""
          }`
        );
        if (d.mastered && d.url) {
          onDone(d.url, d);
          return; // stop polling
        }
      } catch (e) {
        // ignore transient errors and keep polling
      }
      setTimeout(tick, 3000);
    }

    setTimeout(tick, 0);
    return () => {
      canceled = true;
      controller.abort();
    };
  };
}

// choose default intensity (prefer L3, else lowest available)
function chooseDefaultIntensity(list) {
  const l3 = list.find((x) => x.available && x.level === 3);
  if (l3) return 3;
  const mins = list
    .filter((x) => x.available)
    .sort((a, b) => a.level - b.level);
  return mins.length ? mins[0].level : null;
}

/* ---------------------------------- page ---------------------------------- */

export default function Page() {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("process"); // process | lite | warm
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);

  // Player sources
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState(null);
  const [masteredFiles, setMasteredFiles] = useState([]); // array of URLs
  const [selectedMasteredIndex, setSelectedMasteredIndex] = useState(0);
  const [isOriginal, setIsOriginal] = useState(true);

  // Intensities from /api/mastering/[jobId]/audio
  const [intensities, setIntensities] = useState([]); // [{level, available, url}]
  const [originalFromAPI, setOriginalFromAPI] = useState(null);
  const [selectedIntensityLevel, setSelectedIntensityLevel] = useState(null);

  // refs
  const parentPollCancelRef = useRef(null);
  const cfPollCancelRef = useRef(null);
  const s3KeyRef = useRef(null);

  const onDrop = useCallback(
    (accepted) => {
      if (!accepted?.length) return;
      const f = accepted[0];
      log("onDrop:", f?.name, f?.size);

      // cleanup previous
      try {
        if (originalPreviewUrl) URL.revokeObjectURL(originalPreviewUrl);
      } catch {}
      if (parentPollCancelRef.current) {
        parentPollCancelRef.current();
        parentPollCancelRef.current = null;
      }
      if (cfPollCancelRef.current) {
        cfPollCancelRef.current();
        cfPollCancelRef.current = null;
      }

      setFile(f);
      setTitle(f.name.replace(/\.[^/.]+$/, ""));
      setStatus(
        `Selected: ${f.name} (${(f.size / (1024 * 1024)).toFixed(2)} MB)`
      );
      setProgress(0);
      setJobId(null);
      setDownloadUrl(null);
      setOriginalPreviewUrl(URL.createObjectURL(f));
      setMasteredFiles([]);
      setSelectedMasteredIndex(0);
      setIsOriginal(true);
      setIntensities([]);
      setOriginalFromAPI(null);
      setSelectedIntensityLevel(null);
      s3KeyRef.current = null;
    },
    [originalPreviewUrl]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "audio/*": [".wav", ".aiff", ".aif", ".mp3", ".flac", ".ogg", ".m4a"],
    },
  });

  const border = useMemo(
    () => (isDragActive ? "3px dashed #4f46e5" : "3px dashed #9ca3af"),
    [isDragActive]
  );

  // Pull intensities for a job
  const loadIntensities = useCallback(async (jid) => {
    try {
      if (!jid) return;
      setStatus("Loading intensity URLs…");
      const res = await fetch(
        `/api/mastering/${encodeURIComponent(jid)}/audio?intensity=all`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        console.warn("intensity fetch non-OK:", res.status);
        return;
      }
      const data = await res.json(); // { originalUrl, expectedKey?, expectedUrl?, intensities: [...] }
      setOriginalFromAPI(data.originalUrl || null);

      if (data?.expectedKey) log("expectedKey (/audio):", data.expectedKey);
      if (data?.expectedUrl) log("expectedUrl (/audio):", data.expectedUrl);

      const list = Array.isArray(data.intensities) ? data.intensities : [];
      setIntensities(list);

      const def = chooseDefaultIntensity(list);
      setSelectedIntensityLevel(def);
      if (def != null) {
        // prefer intensity list for masteredFiles UI
        const urls = list
          .filter((x) => x.available && x.url)
          .sort((a, b) => a.level - b.level)
          .map((x) => x.url);
        if (urls.length) {
          setMasteredFiles(urls);
          const defIdx = Math.max(
            0,
            urls.findIndex((u) => u === list.find((x) => x.level === def)?.url)
          );
          setSelectedMasteredIndex(defIdx);
          setIsOriginal(false);
          setDownloadUrl(urls[0]);
          setStatus("Intensity ladder ready.");
        }
      } else {
        setStatus("No intensity URLs reported yet.");
      }
    } catch (e) {
      console.warn("loadIntensities error:", e);
    }
  }, []);

  // Parent poller instance (created per job)
  const makeAndStartParentPolling = useCallback(
    (jid) => {
      const start = makeParentPoller({
        jobId: jid,
        setStatus,
        onDone: (url, payload) => {
          // stop CF poller if still running
          if (cfPollCancelRef.current) {
            cfPollCancelRef.current();
            cfPollCancelRef.current = null;
          }
          // surface expectedKey/Url/deliverables when mastered flips, too
          if (payload?.expectedKey) log("expectedKey:", payload.expectedKey);
          if (payload?.expectedUrl) log("expectedUrl:", payload.expectedUrl);
          if (Array.isArray(payload?.deliverables))
            log("deliverables:", payload.deliverables);

          setDownloadUrl(url);
          const variants = buildVariantsFrom(url);
          setMasteredFiles(variants);
          setSelectedMasteredIndex(Math.min(1, variants.length - 1));
          setIsOriginal(false);

          // pull intensities once mastered flips
          loadIntensities(jid);
        },
      });
      parentPollCancelRef.current = start();
    },
    [loadIntensities]
  );

  useEffect(() => {
    return () => {
      if (parentPollCancelRef.current) parentPollCancelRef.current();
      if (cfPollCancelRef.current) cfPollCancelRef.current();
      try {
        if (originalPreviewUrl) URL.revokeObjectURL(originalPreviewUrl);
      } catch {}
    };
  }, [originalPreviewUrl]);

  // Manual probe button
  const startCfProbe = useCallback(() => {
    const key = s3KeyRef.current;
    if (!key) {
      setStatus("No s3Key yet — upload first.");
      return;
    }
    if (cfPollCancelRef.current) cfPollCancelRef.current();
    cfPollCancelRef.current = makeCfPoller({
      s3Key: key,
      setStatus,
      onFound: (urls) => {
        // sort: prefer mp3, then lower variant index
        const vr = (u) => {
          const a = u.match(/\/v(\d+)\.(mp3|wav|m4a|flac)$/i);
          const b = u.match(/_v(\d+)\.(mp3|wav|m4a|flac)$/i);
          const m = a || b;
          return m ? parseInt(m[1], 10) : 999;
        };
        const extRank = (u) =>
          /\.mp3$/i.test(u)
            ? 0
            : /\.m4a$/i.test(u)
            ? 1
            : /\.wav$/i.test(u)
            ? 2
            : 3;

        const sorted = [...urls].sort(
          (A, B) =>
            extRank(A) - extRank(B) || vr(A) - vr(B) || A.length - B.length
        );

        log("CF found urls:", sorted);
        setDownloadUrl(sorted[0]);
        setMasteredFiles(sorted);
        setSelectedMasteredIndex(0);
        setIsOriginal(false);
        setStatus("Mastered file available (CloudFront)");
      },
    });
  }, [setStatus]);

  async function handleStart() {
    // tiny helpers for readable logs
    const now = () =>
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const peek = (s, n = 400) =>
      typeof s === "string" && s.length > n
        ? s.slice(0, n) + "…[truncated]"
        : s;
    const dumpHeaders = (h) => {
      const out = {};
      try {
        for (const [k, v] of h.entries()) out[k] = v;
      } catch {}
      return out;
    };

    try {
      if (!file) return;
      const t0 = now();

      /* ----------------------------- STEP 1: SIGNED URL ----------------------------- */
      console.groupCollapsed(
        "%c[STEP 1] Request /api/upload-url",
        "color:#0366d6;font-weight:bold;"
      );
      console.log(
        "file.name:",
        file?.name,
        "file.type:",
        file?.type,
        "file.size(bytes):",
        file?.size
      );

      setStatus("Requesting upload URL…");
      const upReqBody = {
        fileName: file.name,
        fileType: file.type || "audio/wav",
      };
      console.log("POST /api/upload-url body:", upReqBody);

      const up = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upReqBody),
      });

      console.log("upload-url status:", up.status);
      console.log("upload-url headers:", dumpHeaders(up.headers));

      if (!up.ok) {
        const errTxt = await up.text().catch(() => "");
        console.error("upload-url NON-OK body:", peek(errTxt));
        console.groupEnd();
        setStatus(
          `Upload URL error (${up.status}): ${errTxt || "Unknown error"}`
        );
        return;
      }

      let upJson;
      try {
        upJson = await up.json();
      } catch (e) {
        console.error("upload-url JSON parse error:", e);
        const raw = await up.text().catch(() => "");
        console.error("upload-url raw body:", peek(raw));
        console.groupEnd();
        setStatus("Upload-URL returned non-JSON");
        return;
      }

      const { uploadUrl, s3Key, headers, expiresIn } = upJson || {};
      console.log("upload-url response:", {
        uploadUrl: peek(uploadUrl, 120),
        s3Key,
        headers,
        expiresIn,
      });
      s3KeyRef.current = s3Key;
      console.groupEnd();

      setStatus(`Got signed URL (expires in ${expiresIn}s). Uploading to S3…`);

      /* ------------------------------ STEP 2: UPLOAD S3 ----------------------------- */
      console.groupCollapsed(
        "%c[STEP 2] PUT to S3 (signed URL)",
        "color:#28a745;font-weight:bold;"
      );
      console.log("PUT", uploadUrl);
      let lastPct = 0;
      try {
        await axios.put(uploadUrl, file, {
          headers: headers || {},
          onUploadProgress: (e) => {
            if (!e.total) return;
            const pct = Math.round((e.loaded / e.total) * 100);
            if (pct !== lastPct) {
              lastPct = pct;
              setProgress(pct);
              if (pct % 10 === 0 || pct === 100)
                console.log(`upload progress: ${pct}%`);
            }
          },
        });
        console.log("S3 PUT complete");
      } catch (e) {
        console.error("S3 PUT error:", {
          message: e?.message,
          status: e?.response?.status,
          data: peek(e?.response?.data),
        });
        console.groupEnd();
        setStatus(`S3 upload failed: ${e?.message || "unknown"}`);
        return;
      }
      console.groupEnd();

      setStatus("Upload complete. Submitting mastering job…");

      /* ---------------------------- STEP 3: SUBMIT MASTER --------------------------- */
      console.groupCollapsed(
        "%c[STEP 3] POST /api/mastering",
        "color:#d73a49;font-weight:bold;"
      );
      const idem =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;

      const extFromName = (file.name?.split(".").pop() || "").toLowerCase();
      const sizeMB = Number((file.size / (1024 * 1024)).toFixed(2));

      // Send only what the upstream needs; avoid overriding engine selection.
      const submitBody = {
        // keys
        s3Key,
        key: s3Key,

        // your original mode token
        mode, // "process" | "lite" | "warm"

        // basic metadata many backends like to have (safe to include)
        title: (title || file.name).replace(/\.[^/.]+$/, ""),
        ext: extFromName || (s3Key.split(".").pop() || "").toLowerCase(),
        contentType: file.type || "audio/wav",
        sizeBytes: file.size,
        sizeMB,
        size: sizeMB,
      };

      console.log("Idempotency-Key:", idem);
      console.log("POST /api/mastering body:", submitBody);

      // Start CF probe early so we don't miss early availability
      console.log("Starting CF probe early with s3Key:", s3KeyRef.current);
      startCfProbe();

      const sub = await fetch("/api/mastering", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": idem,
        },
        body: JSON.stringify(submitBody),
      });

      console.log("submit status:", sub.status);
      const subHeaders = dumpHeaders(sub.headers);
      console.log("submit headers:", subHeaders);

      // read raw body regardless
      const subText = await sub.text().catch(() => "");
      console.log("submit raw body (peek):", peek(subText));

      const upstreamReqId =
        subHeaders["x-upstream-request-id"] ||
        subHeaders["x-request-id"] ||
        subHeaders["x-amzn-requestid"] ||
        null;
      if (upstreamReqId)
        console.log("submit upstream request id:", upstreamReqId);

      if (sub.status === 202) {
        console.warn(
          "submit returned 202 Accepted (busy / async). Using CF probe path."
        );
        console.groupEnd();
        setStatus("Submit accepted (upstream busy). Watching CloudFront…");
        console.log(`Total elapsed ~${Math.round(now() - t0)}ms`);
        return;
      }

      if (!sub.ok) {
        // Do NOT throw — show message and keep CF probe alive.
        let message = subText || "Failed to trigger mastering";
        try {
          const j = JSON.parse(subText);
          message = j?.details || j?.error || message;
        } catch {}
        setStatus(
          `Submit failed (${sub.status})${
            upstreamReqId ? ` [req:${upstreamReqId}]` : ""
          }: ${message}`
        );
        console.groupEnd();
        return;
      }

      // OK -> parse JSON
      let payload = null;
      try {
        payload = subText ? JSON.parse(subText) : {};
      } catch (e) {
        console.error("submit JSON parse error:", e);
        console.groupEnd();
        setStatus("Submit returned non-JSON body");
        return;
      }

      console.log("submit payload:", payload);
      const jid = payload?.jobId || null;
      if (payload?.expectedKey)
        console.log("expectedKey (submit):", payload.expectedKey);
      if (payload?.expectedUrl)
        console.log("expectedUrl (submit):", payload.expectedUrl);

      if (jid) {
        console.log("jobId:", jid);
        setJobId(jid);
        setStatus(`Job queued: ${jid}. Polling parent + CloudFront…`);

        // ensure any old poller is stopped
        if (parentPollCancelRef.current) parentPollCancelRef.current();

        // kick parent polling
        console.log("Starting parent poller…");
        makeAndStartParentPolling(jid);

        // prefetch intensity URLs so ladder is ready ASAP
        console.log("Prefetching intensities for jobId:", jid);
        loadIntensities(jid);
      } else {
        console.warn("No jobId returned from submit; will rely on CF probe.");
        setStatus("Submitted. No jobId returned; probing CloudFront…");
      }

      console.groupEnd();
      console.log(
        `%cAll steps done. Elapsed: ${Math.round(now() - t0)}ms`,
        "color:#555;"
      );
    } catch (err) {
      console.groupCollapsed(
        "%c[ERROR] handleStart",
        "color:#b00020;font-weight:bold;"
      );
      console.error("Error object:", err);
      console.error("Message:", err?.message);
      console.error("Stack:", err?.stack);
      console.groupEnd();

      setStatus(`Error: ${(err && err.message) || String(err)}`);

      // On hard runtime errors, it's safe to stop parent poller,
      // but keep CF probe alive in case upstream finishes.
      if (parentPollCancelRef.current) {
        try {
          parentPollCancelRef.current();
        } catch {}
        parentPollCancelRef.current = null;
      }
      // DO NOT cancel cfPollCancelRef here — keep watching CF.
    }
  }

  /* ---------------------------------- UI ---------------------------------- */

  return (
    <main style={{ maxWidth: 840, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>
        Chosen Masters — B2B Mastering Demo
      </h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Upload via signed URL, submit for mastering, then watch CloudFront for
        outputs. This build also shows expected paths and an intensity ladder.
      </p>

      <div
        {...getRootProps()}
        style={{
          border,
          borderRadius: 12,
          padding: 24,
          textAlign: "center",
          cursor: "pointer",
          marginBottom: 16,
          background: isDragActive ? "#eef2ff" : "#f9fafb",
        }}
      >
        <input {...getInputProps()} />
        <strong>
          {isDragActive ? "Release to drop" : "Drag & drop your audio here"}
        </strong>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
          Supported: WAV, AIFF, MP3, FLAC, OGG, M4A
        </div>
      </div>

      <label style={{ display: "block", marginBottom: 8 }}>
        Track Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="My Track"
          style={{
            display: "block",
            width: "100%",
            marginTop: 6,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
          }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 16 }}>
        Mode
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{
            display: "block",
            width: "100%",
            marginTop: 6,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: "white",
          }}
        >
          <option value="process">process (Modern)</option>
          <option value="lite">lite (Open)</option>
          <option value="warm">warm (Powerful)</option>
        </select>
      </label>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={handleStart}
          disabled={!file}
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid #111827",
            background: file ? "#111827" : "#6b7280",
            color: "white",
            cursor: file ? "pointer" : "not-allowed",
          }}
        >
          {file ? "Start Mastering" : "Select a file first"}
        </button>

        <button
          onClick={startCfProbe}
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid #4b5563",
            background: "white",
            color: "#111827",
          }}
          title="Run CloudFront probe now"
        >
          Force Probe
        </button>
      </div>

      {progress > 0 && progress < 100 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            Uploading: {progress}%
          </div>
          <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999 }}>
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                background: "#4f46e5",
                borderRadius: 999,
                transition: "width .2s",
              }}
            />
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, color: "#111827", whiteSpace: "pre-wrap" }}>
        {status}
      </div>

      {jobId && !downloadUrl && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
          Job ID: {jobId}
        </div>
      )}

      {/* Intensity UI (only when /audio data exists) */}
      {(originalFromAPI || intensities.length > 0) && (
        <div
          style={{
            marginTop: 16,
            padding: 10,
            border: "1px solid #e5e7eb",
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 6, color: "#374151" }}>
            Intensity
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                setIsOriginal(true);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: isOriginal ? "#111827" : "white",
                color: isOriginal ? "white" : "#111827",
              }}
              title="Original"
            >
              Original
            </button>

            {intensities.map((it) => (
              <button
                key={`L${it.level}`}
                disabled={!it.available}
                onClick={() => {
                  if (!it.available || !it.url) return;
                  setIsOriginal(false);
                  setSelectedIntensityLevel(it.level);
                  const idx = masteredFiles.findIndex((u) => u === it.url);
                  if (idx >= 0) setSelectedMasteredIndex(idx);
                  else {
                    setMasteredFiles((prev) => [it.url, ...prev]);
                    setSelectedMasteredIndex(0);
                  }
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background:
                    !isOriginal && selectedIntensityLevel === it.level
                      ? "#111827"
                      : "white",
                  color:
                    !isOriginal && selectedIntensityLevel === it.level
                      ? "white"
                      : "#111827",
                  opacity: it.available ? 1 : 0.5,
                  cursor: it.available ? "pointer" : "not-allowed",
                }}
                title={
                  it.available ? `Play level ${it.level}` : "Not available yet"
                }
              >
                L{it.level}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
            {selectedIntensityLevel
              ? `Playing Level ${selectedIntensityLevel}`
              : isOriginal
              ? "Playing Original"
              : "Select an intensity to A/B"}
          </div>
        </div>
      )}

      {(originalPreviewUrl || originalFromAPI || masteredFiles.length > 0) && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(originalPreviewUrl || originalFromAPI) && (
              <button
                onClick={() => setIsOriginal(true)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background: isOriginal ? "#111827" : "white",
                  color: isOriginal ? "white" : "#111827",
                }}
              >
                Original {originalFromAPI ? "" : "(Local)"}
              </button>
            )}
            {masteredFiles.map((u, i) => (
              <button
                key={u}
                onClick={() => {
                  setSelectedMasteredIndex(i);
                  setIsOriginal(false);
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background:
                    !isOriginal && selectedMasteredIndex === i
                      ? "#111827"
                      : "white",
                  color:
                    !isOriginal && selectedMasteredIndex === i
                      ? "white"
                      : "#111827",
                }}
              >
                Master v{i + 1}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 10 }}>
            <audio
              key={
                (isOriginal
                  ? originalFromAPI || originalPreviewUrl
                  : masteredFiles[selectedMasteredIndex]) || "empty"
              }
              controls
              crossOrigin="anonymous"
              src={
                isOriginal
                  ? originalFromAPI || originalPreviewUrl || undefined
                  : masteredFiles[selectedMasteredIndex] || undefined
              }
              style={{ width: "100%" }}
            />
          </div>
        </div>
      )}

      {downloadUrl && (
        <div style={{ marginTop: 16 }}>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block",
              padding: "10px 14px",
              borderRadius: 10,
              background: "#10b981",
              color: "white",
              textDecoration: "none",
            }}
          >
            Download Mastered File
          </a>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
            CloudFront link remains available ~30 days — save what you want to
            keep.
          </div>
        </div>
      )}
    </main>
  );
}
