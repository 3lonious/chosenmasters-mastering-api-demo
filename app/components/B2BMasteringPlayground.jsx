import React, { useState } from "react";
import axios from "axios";

const API_KEY =
  "35314b7a907a6f0cecbcb03aee8bc83e543a9f737c49fe351122aa0f61079d82";

const B2BMasteringPlayground = () => {
  const [fileName, setFileName] = useState("mix.wav");
  const [fileType, setFileType] = useState("audio/wav");
  const [uploadResult, setUploadResult] = useState(null);
  const [submissionForm, setSubmissionForm] = useState({
    s3Key: "",
    title: "",
    ext: "wav",
    size: "",
    mode: "process",
  });
  const [jobId, setJobId] = useState("");
  const [statusResult, setStatusResult] = useState(null);
  const [audioResult, setAudioResult] = useState(null);
  const [intensityLevel, setIntensityLevel] = useState(3);
  const [playerMode, setPlayerMode] = useState("mastered");

  const requestUploadUrl = async (event) => {
    event.preventDefault();
    const { data } = await axios.post(
      "https://chosenmasters.com/api/b2b/mastering/upload-url",
      { fileName, fileType },
      { headers: { "x-api-key": API_KEY } }
    );
    setUploadResult(data);
    setSubmissionForm((current) => ({
      ...current,
      s3Key: data.s3Key || current.s3Key,
      title: fileName.replace(/\.[^/.]+$/, ""),
      ext: fileName.split(".").pop() || current.ext,
    }));
    setAudioResult(null);
  };

  const submitMastering = async (event) => {
    event.preventDefault();
    const { data } = await axios.post(
      "https://chosenmasters.com/api/b2b/mastering",
      submissionForm,
      { headers: { "x-api-key": API_KEY } }
    );
    setJobId(data.jobId || "");
    setAudioResult(null);
  };

  const checkStatus = async (event) => {
    event.preventDefault();
    const { data } = await axios.get(
      "https://chosenmasters.com/api/b2b/mastering/" + jobId,
      { headers: { "x-api-key": API_KEY } }
    );
    setStatusResult(data);
  };

  const loadAudio = async (event) => {
    event.preventDefault();
    const { data } = await axios.get(
      "https://chosenmasters.com/api/b2b/mastering/" + jobId + "/audio",
      {
        headers: { "x-api-key": API_KEY },
        params: { intensity: "all" },
      }
    );
    setAudioResult(data);
    if (Array.isArray(data.availableLevels) && data.availableLevels.length) {
      setIntensityLevel(data.availableLevels[0]);
      setPlayerMode("mastered");
    } else {
      setPlayerMode("original");
    }
  };

  const masteredEntry = audioResult?.intensities?.find(
    (entry) => entry.level === intensityLevel && entry.available
  );
  const playbackUrl =
    playerMode === "original"
      ? audioResult?.originalUrl
      : masteredEntry?.url || "";

  return (
    <div className="space-y-8">
      <form onSubmit={requestUploadUrl} className="space-y-4">
        <h2>1. Request upload URL</h2>
        <label>
          File name
          <input
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
          />
        </label>
        <label>
          File type
          <input
            value={fileType}
            onChange={(event) => setFileType(event.target.value)}
          />
        </label>
        <button type="submit">Request URL</button>
      </form>

      {uploadResult && <pre>{JSON.stringify(uploadResult, null, 2)}</pre>}

      <form onSubmit={submitMastering} className="space-y-4">
        <h2>2. Submit mastering job</h2>
        <label>
          S3 key
          <input
            value={submissionForm.s3Key}
            onChange={(event) =>
              setSubmissionForm((current) => ({
                ...current,
                s3Key: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Title
          <input
            value={submissionForm.title}
            onChange={(event) =>
              setSubmissionForm((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Extension
          <input
            value={submissionForm.ext}
            onChange={(event) =>
              setSubmissionForm((current) => ({
                ...current,
                ext: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Size (MB)
          <input
            value={submissionForm.size}
            onChange={(event) =>
              setSubmissionForm((current) => ({
                ...current,
                size: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Mode
          <select
            value={submissionForm.mode}
            onChange={(event) =>
              setSubmissionForm((current) => ({
                ...current,
                mode: event.target.value,
              }))
            }
          >
            <option value="process">Modern</option>
            <option value="lite">Open</option>
            <option value="warm">Powerful</option>
          </select>
        </label>
        <button type="submit">Submit</button>
      </form>

      {jobId && <p>Job ID: {jobId}</p>}

      <form onSubmit={checkStatus} className="space-y-4">
        <h2>3. Poll job status</h2>
        <label>
          Job ID
          <input
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
          />
        </label>
        <button type="submit">Check status</button>
      </form>

      {statusResult && <pre>{JSON.stringify(statusResult, null, 2)}</pre>}

      <form onSubmit={loadAudio} className="space-y-4">
        <h2>4. Preview mastered audio</h2>
        <label>
          Job ID
          <input
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            placeholder="job_1234"
            required
          />
        </label>
        <div>
          <button type="submit">Load mastered files</button>
          <span className="text-xs">
            Calls <code>GET /api/b2b/mastering/:id/audio</code>
          </span>
        </div>
      </form>

      {audioResult && (
        <div className="space-y-6">
          <div>
            <div>
              <button
                type="button"
                onClick={() => setPlayerMode("original")}
                disabled={!audioResult?.originalUrl}
                className={
                  "rounded-full px-4 py-1 text-sm font-semibold transition " +
                  (playerMode === "original"
                    ? "bg-black text-white"
                    : "text-black")
                }
              >
                Original
              </button>
              <button
                type="button"
                onClick={() => setPlayerMode("mastered")}
                disabled={
                  !audioResult?.intensities?.some((e) => e.available && e.url)
                }
                className={
                  "rounded-full px-4 py-1 text-sm font-semibold transition " +
                  (playerMode === "mastered"
                    ? "bg-black text-white"
                    : "text-black")
                }
              >
                Mastered
              </button>
            </div>

            <div>
              <div>
                <span>Intensity</span>
                <span>{intensityLevel}</span>
              </div>
              <div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={intensityLevel}
                  onChange={(event) =>
                    setIntensityLevel(Number(event.target.value))
                  }
                  disabled={
                    !audioResult?.intensities?.some((e) => e.available && e.url)
                  }
                />
              </div>
            </div>

            <div>
              {playbackUrl ? (
                <audio
                  key={playerMode + "-" + intensityLevel}
                  controls
                  src={playbackUrl}
                />
              ) : (
                <p>No audio is available for the current selection yet.</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {(audioResult?.intensities || []).map((entry) => (
                <span
                  key={"intensity-" + entry.level}
                  className={
                    "rounded-full border px-3 py-1 " +
                    (entry.available ? "border-black" : "opacity-60")
                  }
                >
                  Level {entry.level}:{" "}
                  {entry.available ? "Ready" : "Processing"}
                </span>
              ))}
            </div>
          </div>

          <div className="code-copy-actions">
            <button
              type="button"
              className={"code-copy-button"}
              onClick={() =>
                navigator.clipboard &&
                navigator.clipboard.writeText(
                  JSON.stringify(audioResult, null, 2)
                )
              }
            >
              <span aria-hidden="true" className="code-copy-icon">
                📋
              </span>
              <span>Copy response</span>
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border bg-gray-50 p-4 text-sm">
            {JSON.stringify(audioResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default B2BMasteringPlayground;
