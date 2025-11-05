"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
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

function extractExtension(url) {
  if (!url) return null;
  const [path] = url.split("?");
  const match = path.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function swapExtension(url, nextExt) {
  if (!url || !nextExt) return url;
  const normalized = nextExt.toLowerCase();
  const [path, query] = url.split("?");
  const extMatch = path.match(/\.([a-z0-9]+)$/i);
  if (!extMatch) return url;
  if (extMatch[1].toLowerCase() === normalized) return url;
  const updatedPath = path.replace(/\.(mp3|wav|m4a|flac)$/i, `.${normalized}`);
  return query ? `${updatedPath}?${query}` : updatedPath;
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

// choose default intensity (prefer L3, else lowest level regardless of availability)
function chooseDefaultIntensity(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const l3 = list.find((x) => x.level === 3);
  if (l3) return 3;
  const mins = [...list].sort((a, b) => a.level - b.level);
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
  const [downloadFormat, setDownloadFormat] = useState(null);

  // Player sources
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState(null);
  const [masteredFiles, setMasteredFiles] = useState([]); // array of URLs
  const [selectedMasteredIndex, setSelectedMasteredIndex] = useState(0);
  const [isOriginal, setIsOriginal] = useState(true);

  // Intensities from /api/mastering/[jobId]/audio
  const [intensities, setIntensities] = useState([]); // [{level, available, url}]
  const [originalFromAPI, setOriginalFromAPI] = useState(null);
  const [selectedIntensityLevel, setSelectedIntensityLevel] = useState(null);
  const [requestedLevels, setRequestedLevels] = useState([]);

  // refs
  const parentPollCancelRef = useRef(null);
  const cfPollCancelRef = useRef(null);
  const intensityPollCancelRef = useRef(null);
  const s3KeyRef = useRef(null);

  // NEW: track when CloudFront first becomes available to start a 30s grace window
  const cfFirstDetectedAtRef = useRef(null);

  const selectedMasteredUrl = useMemo(() => {
    if (!masteredFiles.length) return null;
    const safeIndex = Math.min(
      Math.max(selectedMasteredIndex, 0),
      masteredFiles.length - 1
    );
    return masteredFiles[safeIndex] || null;
  }, [masteredFiles, selectedMasteredIndex]);

  const baseDownloadExtension = useMemo(
    () => extractExtension(selectedMasteredUrl),
    [selectedMasteredUrl]
  );

  const availableDownloadFormats = useMemo(() => {
    if (!selectedMasteredUrl) return [];
    const options = [];
    const seen = new Set();
    const push = (value, label) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      options.push({ value, label });
    };

    if (baseDownloadExtension) {
      push(baseDownloadExtension, baseDownloadExtension.toUpperCase());
    } else {
      push("mp3", "MP3");
    }

    if (baseDownloadExtension !== "wav") {
      push("wav", "WAV");
    }

    return options;
  }, [baseDownloadExtension, selectedMasteredUrl]);

  useEffect(() => {
    if (!selectedMasteredUrl) {
      setDownloadFormat(null);
      setDownloadUrl(null);
      return;
    }

    const ext = baseDownloadExtension || "mp3";
    setDownloadFormat((prev) => {
      if (!prev) return ext;
      if (prev === "wav") return prev;
      return ext;
    });
  }, [baseDownloadExtension, selectedMasteredUrl]);

  useEffect(() => {
    if (!selectedMasteredUrl) {
      setDownloadUrl(null);
      return;
    }

    const targetExt = (
      downloadFormat ||
      baseDownloadExtension ||
      "mp3"
    ).toLowerCase();
    const currentExt = extractExtension(selectedMasteredUrl);
    const nextUrl =
      currentExt && currentExt === targetExt
        ? selectedMasteredUrl
        : swapExtension(selectedMasteredUrl, targetExt);
    setDownloadUrl(nextUrl);
  }, [baseDownloadExtension, downloadFormat, selectedMasteredUrl]);

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
      if (intensityPollCancelRef.current) {
        intensityPollCancelRef.current();
        intensityPollCancelRef.current = null;
      }

      setFile(f);
      setTitle(f.name.replace(/\.[^/.]+$/, ""));
      setStatus(
        `Selected: ${f.name} (${(f.size / (1024 * 1024)).toFixed(2)} MB)`
      );
      setProgress(0);
      setJobId(null);
      setDownloadUrl(null);
      setDownloadFormat(null);
      setOriginalPreviewUrl(URL.createObjectURL(f));
      setMasteredFiles([]);
      setSelectedMasteredIndex(0);
      setIsOriginal(true);
      setIntensities([]);
      setOriginalFromAPI(null);
      setSelectedIntensityLevel(null);
      setRequestedLevels([]);
      s3KeyRef.current = null;
      cfFirstDetectedAtRef.current = null; // reset CF grace window
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

  // Pull intensities for a job (keep polling beyond Level 3; stop when all ready or CF grace window elapses)
  const loadIntensities = useCallback((jid) => {
    if (!jid) return;

    if (intensityPollCancelRef.current) {
      intensityPollCancelRef.current();
      intensityPollCancelRef.current = null;
    }

    let canceled = false;
    let timeoutId = null;

    const cancel = () => {
      canceled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    intensityPollCancelRef.current = cancel;

    async function tick(initial = false) {
      if (canceled) return;
      try {
        if (initial) setStatus("Loading intensity URLs…");
        const res = await fetch(
          `/api/mastering/${encodeURIComponent(jid)}/audio?intensity=all`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          console.warn("intensity fetch non-OK:", res.status);
        } else {
          const data = await res.json(); // { originalUrl, intensities, requestedLevels?, ... }
          setOriginalFromAPI(data.originalUrl || null);

          if (data?.expectedKey) log("expectedKey (/audio):", data.expectedKey);
          if (data?.expectedUrl) log("expectedUrl (/audio):", data.expectedUrl);

          const list = Array.isArray(data.intensities) ? data.intensities : [];
          setIntensities(list);

          // Track requested levels (fallback to all 1..5 if not provided)
          const requested =
            Array.isArray(data?.requestedLevels) && data.requestedLevels.length
              ? data.requestedLevels
              : [1, 2, 3, 4, 5];
          setRequestedLevels(requested);

          // Detect first playable (this implies CloudFront availability)
          const playable = list
            .filter((x) => x.available && x.url)
            .sort((a, b) => a.level - b.level);

          // Record CF detection time if we see any playable URL via /audio
          if (playable.length && !cfFirstDetectedAtRef.current) {
            cfFirstDetectedAtRef.current = Date.now();
          }

          // Keep the masteredFiles button cluster aligned to intensity URLs
          const urls = playable.map((x) => x.url);
          if (urls.length) {
            setMasteredFiles(urls);
          }

          // Prefer Level 3 selection when it becomes available — but DO NOT stop polling
          const preferredLevel = chooseDefaultIntensity(list);
          const preferredEntry =
            preferredLevel != null
              ? list.find(
                  (x) =>
                    x.level === preferredLevel && x.available && Boolean(x.url)
                )
              : null;

          if (preferredEntry) {
            setSelectedIntensityLevel(preferredLevel);
            if (urls.length) {
              const defIdx = urls.findIndex((u) => u === preferredEntry.url);
              if (defIdx >= 0) {
                setSelectedMasteredIndex(defIdx);
              }
            }
            setIsOriginal(false);
          }

          // Progress status: which levels are ready vs pending?
          const readyLevels = new Set(playable.map((p) => p.level));
          const pending = requested.filter((lvl) => !readyLevels.has(lvl));
          const readyList = [...readyLevels].sort((a, b) => a - b);
          if (readyList.length) {
            setStatus(
              `Ready: L${readyList.join(", ")} • Waiting: ${
                pending.length ? "L" + pending.join(", ") : "-"
              }`
            );
          } else {
            setStatus(
              preferredLevel != null
                ? `Waiting for Level ${preferredLevel} intensity…`
                : "No intensity URLs reported yet."
            );
          }

          // Stop criteria:
          // 1) All requested levels are ready -> stop.
          if (pending.length === 0 && requested.length > 0) {
            setStatus("All requested intensities are ready.");
            cancel();
            intensityPollCancelRef.current = null;
            return;
          }

          // 2) If CloudFront was detected, stop after ~30s grace window even if a few are still warming.
          if (
            cfFirstDetectedAtRef.current &&
            Date.now() - cfFirstDetectedAtRef.current >= 30_000
          ) {
            setStatus(
              "CloudFront ready; stopping auto-poll after ~30s grace window."
            );
            cancel();
            intensityPollCancelRef.current = null;
            return;
          }
        }
      } catch (e) {
        console.warn("loadIntensities error:", e);
      }

      if (!canceled) {
        timeoutId = setTimeout(() => tick(false), 3000);
      }
    }

    tick(true);
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

          const variants = buildVariantsFrom(url);
          setMasteredFiles(variants);
          setSelectedMasteredIndex(Math.min(1, variants.length - 1));
          setIsOriginal(false);

          // mark CF detected for 30s grace window on intensities
          cfFirstDetectedAtRef.current = Date.now();

          // pull intensities once mastered flips (and keep polling)
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
      if (intensityPollCancelRef.current) {
        intensityPollCancelRef.current();
        intensityPollCancelRef.current = null;
      }
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
        setMasteredFiles(sorted);
        setSelectedMasteredIndex(0);
        setIsOriginal(false);
        setStatus("Mastered file available (CloudFront)");

        // Start 30s grace window for intensities
        if (!cfFirstDetectedAtRef.current) {
          cfFirstDetectedAtRef.current = Date.now();
        }
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
        throw new Error(
          `Upload-URL failed (${up.status}): ${errTxt || "Unknown error"}`
        );
      }

      let upJson;
      try {
        upJson = await up.json();
      } catch (e) {
        console.error("upload-url JSON parse error:", e);
        const raw = await up.text().catch(() => "");
        console.error("upload-url raw body:", peek(raw));
        console.groupEnd();
        throw new Error("Upload-URL returned non-JSON");
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
          headers,
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
        throw new Error(`S3 upload failed: ${e?.message || "unknown"}`);
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

      const submitBody = {
        // keys
        s3Key,
        key: s3Key,

        // mode (your token)
        mode, // "process" | "lite" | "warm"

        // helpful metadata
        title: (title || file.name).replace(/\.[^/.]+$/, ""),
        ext: extFromName || (s3Key.split(".").pop() || "").toLowerCase(),
        contentType: file.type || "audio/wav",
        sizeBytes: file.size,
        sizeMB,
        size: sizeMB,
      };

      console.log("Idempotency-Key:", idem);
      console.log("POST /api/mastering body:", submitBody);

      // Start CF probe immediately (now that s3KeyRef is set)
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

      // read body for logging + possible jobId/expectedKey
      const subText = await sub.text().catch(() => "");
      console.log("submit raw body (peek):", peek(subText));

      let payload = null;
      try {
        payload = subText ? JSON.parse(subText) : null;
      } catch {}

      const upstreamReqId =
        subHeaders["x-upstream-request-id"] ||
        subHeaders["x-request-id"] ||
        subHeaders["x-amzn-requestid"] ||
        null;
      if (upstreamReqId)
        console.log("submit upstream request id:", upstreamReqId);

      if (sub.status === 202) {
        console.warn(
          "submit returned 202 Accepted (busy / async). Using CF probe + parent poll."
        );
        setStatus("Submit accepted. Watching CloudFront & polling job…");

        // start parent polling and prefetch intensities even on 202
        const jid = payload?.jobId || null;
        if (jid) {
          console.log("jobId:", jid);
          setJobId(jid);

          if (parentPollCancelRef.current) parentPollCancelRef.current();
          console.log("Starting parent poller…");
          makeAndStartParentPolling(jid);

          console.log("Prefetching intensities for jobId:", jid);
          loadIntensities(jid);
        } else {
          console.warn("202 without jobId; relying on CF probe only.");
        }

        console.groupEnd();
        console.log(`Total elapsed ~${Math.round(now() - t0)}ms`);
        return;
      }

      if (!sub.ok) {
        // Show upstream error but keep CF probe running
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

      // 200-ish OK (rare for async) — parse and proceed
      let okPayload = null;
      try {
        okPayload = subText ? JSON.parse(subText) : {};
      } catch (e) {
        console.error("submit JSON parse error:", e);
        console.groupEnd();
        throw new Error("Submit returned non-JSON body");
      }

      console.log("submit payload:", okPayload);
      const jid = okPayload?.jobId || null;
      if (okPayload?.expectedKey)
        console.log("expectedKey (submit):", okPayload.expectedKey);
      if (okPayload?.expectedUrl)
        console.log("expectedUrl (submit):", okPayload.expectedUrl);

      if (jid) {
        console.log("jobId:", jid);
        setJobId(jid);
        setStatus(`Job queued: ${jid}. Polling parent + CloudFront…`);

        if (parentPollCancelRef.current) parentPollCancelRef.current();

        console.log("Starting parent poller…");
        makeAndStartParentPolling(jid);

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

      // stop parent poller (keep CF probe alive)
      if (parentPollCancelRef.current) {
        try {
          parentPollCancelRef.current();
        } catch {}
        parentPollCancelRef.current = null;
      }
    }
  }

  /* ---------------------------------- UI ---------------------------------- */

  return (
    <main style={{ maxWidth: 840, margin: "40px auto", padding: 16 }}>
      <nav
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 16,
        }}
      >
        <Link
          href="/mastering-docs"
          style={{
            color: "#2563eb",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Mastering Docs
        </Link>
      </nav>
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
          {!!requestedLevels.length && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
              Requested: L{requestedLevels.join(", ")}
            </div>
          )}
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
          {availableDownloadFormats.length > 0 && (
            <div
              style={{
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "#374151",
              }}
            >
              <span>Download format:</span>
              {availableDownloadFormats.length > 1 ? (
                <select
                  value={downloadFormat || availableDownloadFormats[0].value}
                  onChange={(e) =>
                    setDownloadFormat(e.target.value.toLowerCase())
                  }
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                    background: "white",
                    color: "#111827",
                  }}
                >
                  {availableDownloadFormats.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ fontWeight: 500 }}>
                  {availableDownloadFormats[0].label}
                </span>
              )}
            </div>
          )}
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
            download={
              title
                ? `${title}.${(
                    downloadFormat ||
                    baseDownloadExtension ||
                    "mp3"
                  ).toLowerCase()}`
                : undefined
            }
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
