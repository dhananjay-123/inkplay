'use client';

import { useEffect, useRef, useState } from 'react';

type Props = { onCapture: (video: HTMLVideoElement) => void; onClose: () => void };

/** Live webcam preview + shutter. Works on HTTPS (Vercel) and localhost. */
export function WebcamCapture({ onCapture, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      })
      .catch(() => setError('Camera access was blocked. Upload a photo instead.'));
    if (!navigator.mediaDevices) setError('This browser has no camera access here. Upload a photo instead.');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-4" role="dialog" aria-label="Take a photo of your drawing">
      <div className="w-full max-w-3xl bg-card p-4 shadow-[var(--shadow)]">
        {error ? (
          <p className="font-hand p-8 text-center text-xl">{error}</p>
        ) : (
          <video ref={video} playsInline muted className="aspect-video w-full bg-ink object-cover" />
        )}
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={onClose} className="label px-3 py-2 text-graphite hover:text-ink">
            Cancel
          </button>
          {!error && (
            <button
              type="button"
              onClick={() => video.current && video.current.readyState >= 2 && onCapture(video.current)}
              className="label btn-game px-6 py-3"
            >
              Snap it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
