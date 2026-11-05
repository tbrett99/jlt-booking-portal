import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { StaffField, staffControl, useStaffAuthority } from "./StaffWorkspace";

export default function StaffImageUpload({
  courseId,
  onUploaded,
}: {
  courseId: number;
  onUploaded: (url: string) => void;
}) {
  const access = useStaffAuthority();
  const allowed = access.instructor && access.courseIds.includes(courseId);
  const upload = trpc.academy.admin.uploadCourseImage.useMutation();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const pending = reading || upload.isPending;
  async function handleFile(file: File | undefined) {
    if (!file || !allowed || pending) return;
    setError("");
    setReading(true);
    try {
      const mimeTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
      ] as const;
      if (!file.size || file.size > 8 * 1024 * 1024)
        throw new Error("Choose an image up to 8 MB.");
      if (!mimeTypes.includes(file.type as (typeof mimeTypes)[number]))
        throw new Error("Choose JPEG, PNG, WebP or GIF.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Image could not be read."));
        reader.readAsDataURL(file);
      });
      const stored = await upload.mutateAsync({
        courseId,
        fileName: file.name,
        fileBase64: base64,
        mimeType: file.type as (typeof mimeTypes)[number],
      });
      setUrl(stored.url);
      onUploaded(stored.url);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Image upload failed."
      );
    } finally {
      setReading(false);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <StaffField label="Upload course image (up to 8 MB)">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className={staffControl}
          disabled={!allowed || pending}
          onChange={event => {
            void handleFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </StaffField>
      {pending && (
        <p role="status" className="text-xs text-muted-foreground">
          Uploading to this assigned course…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {url && (
        <div>
          <p className="text-xs text-emerald-800">
            Image uploaded. Save the form to apply it.
          </p>
          <input
            aria-label="Uploaded course image URL"
            readOnly
            className={`${staffControl} mt-2 font-mono text-xs`}
            value={url}
            onFocus={event => event.target.select()}
          />
        </div>
      )}
    </div>
  );
}
