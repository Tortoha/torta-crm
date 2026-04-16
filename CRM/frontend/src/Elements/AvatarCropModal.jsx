import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { X, Minus, Plus, ArrowCounterClockwise, ArrowClockwise } from '@phosphor-icons/react';
import '../Style/AvatarCrop.css';

function createImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', reject);
    img.src = url;
  });
}

async function getCroppedImg(imageSrc, pixelCrop, rotation = 0) {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');

  const maxSize  = Math.max(image.width, image.height);
  const safeArea = 2 * ((maxSize / 2) * Math.sqrt(2));

  canvas.width  = safeArea;
  canvas.height = safeArea;

  ctx.translate(safeArea / 2, safeArea / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-safeArea / 2, -safeArea / 2);
  ctx.drawImage(image, safeArea / 2 - image.width / 2, safeArea / 2 - image.height / 2);

  const data = ctx.getImageData(0, 0, safeArea, safeArea);

  canvas.width  = pixelCrop.width;
  canvas.height = pixelCrop.height;

  ctx.putImageData(
    data,
    Math.round(0 - safeArea / 2 + image.width  * 0.5 - pixelCrop.x),
    Math.round(0 - safeArea / 2 + image.height * 0.5 - pixelCrop.y),
  );

  return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.92));
}

function AvatarCropModal({ file, onSave, onClose }) {
  const [imageSrc, setImageSrc]             = useState(null);
  const [crop,     setCrop]                 = useState({ x: 0, y: 0 });
  const [zoom,     setZoom]                 = useState(1);
  const [rotation, setRotation]             = useState(0);
  const [croppedPixels, setCroppedPixels]   = useState(null);
  const [saving, setSaving]                 = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onCropComplete = useCallback((_, pixels) => setCroppedPixels(pixels), []);

  const handleSave = async () => {
    if (!croppedPixels) return;
    setSaving(true);
    try {
      const blob = await getCroppedImg(imageSrc, croppedPixels, rotation);
      onSave(blob);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="crop-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="crop-modal">

        <div className="crop-head">
          <span className="crop-title">Edit photo</span>
          <button className="crop-close" onClick={onClose} type="button" aria-label="Close">
            <X />
          </button>
        </div>

        <div className="crop-area">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
            />
          )}
        </div>

        <div className="crop-controls">
          <div className="crop-slider-row">
            <span className="crop-slider-label">Zoom</span>
            <div className="crop-slider-wrap">
              <button type="button" className="crop-nudge" onClick={() => setZoom(z => Math.max(1, z - 0.1))} aria-label="Zoom out">
                <Minus />
              </button>
              <input
                type="range" className="crop-range"
                min={1} max={3} step={0.01}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
              />
              <button type="button" className="crop-nudge" onClick={() => setZoom(z => Math.min(3, z + 0.1))} aria-label="Zoom in">
                <Plus />
              </button>
            </div>
          </div>

          <div className="crop-slider-row">
            <span className="crop-slider-label">Rotate</span>
            <div className="crop-slider-wrap">
              <button type="button" className="crop-nudge" onClick={() => setRotation(r => r - 90)} aria-label="Rotate left">
                <ArrowCounterClockwise />
              </button>
              <input
                type="range" className="crop-range"
                min={-180} max={180} step={1}
                value={rotation}
                onChange={e => setRotation(Number(e.target.value))}
              />
              <button type="button" className="crop-nudge" onClick={() => setRotation(r => r + 90)} aria-label="Rotate right">
                <ArrowClockwise />
              </button>
            </div>
          </div>
        </div>

        <div className="crop-actions">
          <button type="button" className="crop-btn-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="crop-btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save photo'}
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
}

export default AvatarCropModal;
