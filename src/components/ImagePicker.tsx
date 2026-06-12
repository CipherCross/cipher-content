import { useRef, useState } from "react";
import { isRenderableImage, uploadPostImage } from "../lib/images";

interface Props {
  postId: string;
  value: string;
  onChange: (url: string) => void;
}

export default function ImagePicker({ postId, value, onChange }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      onChange(await uploadPostImage(postId, file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="field">
      <span>Image (optional)</span>
      <div
        className={`dropzone${dragOver ? " drag-over" : ""}`}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files[0]);
        }}
      >
        {uploading ? (
          <span className="loading-row">
            <span className="spinner" /> Uploading…
          </span>
        ) : isRenderableImage(value) ? (
          <img className="img-preview" src={value} alt="Post image" />
        ) : (
          <span className="muted">Drop an image here, or click to choose</span>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = ""; // allow re-picking the same file
        }}
      />
      <div className="row" style={{ gap: 8 }}>
        <input
          placeholder="…or paste an image / Google Drive link"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button type="button" onClick={() => onChange("")}>
            Remove
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
