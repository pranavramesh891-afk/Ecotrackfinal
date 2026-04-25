import { useState } from 'react';
import { fetchWithAuth } from '../utils/api';

const PLATFORMS = ['Amazon', 'eBay', 'Walmart', 'Other'];

export default function LogWaste() {
  const [platform, setPlatform] = useState('Amazon');
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [locationWarning, setLocationWarning] = useState('');

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setFileName(selectedFile.name);
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result);
      };
      reader.readAsDataURL(selectedFile);
      setAiResult(null); // Reset previous result when new image is selected
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    setAiResult(null);

    try {
      if (!preview) {
        throw new Error('Please upload an image for AI classification.');
      }

      // ── Step 1: Get geolocation with fallback ──
      let location = { lat: 40.7128, lng: -74.0060 }; // Default to NYC
      if ('geolocation' in navigator) {
        try {
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 })
          );
          location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLocationWarning(''); // Clear warning on success
        } catch {
          console.warn("Geolocation denied or timed out. Falling back to default.");
          setLocationWarning("Location access denied. Using default location (New York).");
        }
      } else {
        setLocationWarning("Location access denied. Using default location (New York).");
      }

      console.log("Transmitting image to AI Classifier...");

      // ── Step 2: CALL AI ENDPOINT ──
      const res = await fetchWithAuth('/classify-waste', {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: preview,
          platform: platform,
          location: JSON.stringify(location)
        })
      });

      if (!res) return; // intercept handled by wrapper

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Server error (${res.status}): ${text}`);
      }

      const data = await res.json();
      console.log("Classification result:", data);

      setAiResult({
        category: data.data.type,
        confidence: data.confidence || 0.90
      });

      setStatus({
        type: "success",
        msg: `✅ AI successfully classified and logged your waste!`
      });

      // Cleanup form
      setFile(null);
      setFileName('');
      setPreview(null);
    } catch (error) {
      console.error("Classification error:", error);
      setStatus({
        type: "error",
        msg: error.message || "❌ An error occurred classifying the image."
      });
    } finally {
      setLoading(false);
    }
  };

  const formatConfidence = (conf) => {
    return Math.round(conf * 100) + '%';
  };

  const getEmoji = (type) => {
    if (type === 'plastic') return '♻️';
    if (type === 'cardboard') return '📦';
    if (type === 'paper') return '📄';
    return '';
  };

  return (
    <div className="animate-fade-up">
      <p className="page-title">AI Waste Scanner</p>
      <p className="page-subtitle">Upload packaging evidence and let AI classify your waste.</p>

      {status && (
        <div className={`status-msg ${status.type === 'success' ? 'status-success' : 'status-error'} mb-4`}>
          {status.msg}
        </div>
      )}
      
      {locationWarning && (
        <div className="status-msg status-error mb-4">
          ⚠️ {locationWarning}
        </div>
      )}

      {/* ── AI Result Box ── */}
      {aiResult && (
        <div className="card mb-3 animate-fade-up" style={{ border: '2px solid var(--primary)' }}>
          <div className="card-body" style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--primary)', marginBottom: 8 }}>
              AI Vision Results
            </p>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>
              {getEmoji(aiResult.category)}
            </div>
            <h3 style={{ textTransform: 'capitalize', margin: 0, marginBottom: 4 }}>
              {aiResult.category}
            </h3>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              Confidence: {formatConfidence(aiResult.confidence)}
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* ── Platform ── */}
        <div className="card mb-3">
          <div className="card-body">
            <div className="form-group" style={{ gap: 0, margin: 0 }}>
              <label htmlFor="platform-select" style={{ marginBottom: '8px', display: 'block' }}>
                Platform / Retailer
              </label>
              <select
                id="platform-select"
                value={platform}
                onChange={e => setPlatform(e.target.value)}
              >
                {PLATFORMS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Image Upload & Preview ── */}
        <div className="card mb-4">
          <div className="card-body">
            <label style={{ display: 'block', marginBottom: '12px' }}>
              Image Evidence <span style={{ color: 'var(--primary)', fontWeight: 600 }}>*</span>
            </label>
            
            <label className="image-upload-wrapper" htmlFor="file-upload" style={{ padding: preview ? '10px' : '32px' }}>
              {preview ? (
                <div style={{ width: '100%', borderRadius: '10px', overflow: 'hidden', position: 'relative' }}>
                  <img src={preview} alt="Upload preview" style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: '300px' }} />
                  <div style={{ position: 'absolute', bottom: 10, left: 10, right: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '8px', borderRadius: '8px', fontSize: '0.85rem' }}>
                    Tap to change image
                  </div>
                </div>
              ) : (
                <>
                  <span className="upload-icon">📷</span>
                  <span className="upload-text">Tap to capture or upload</span>
                  <span className="upload-hint">Supports JPG, PNG, HEIC</span>
                  <span className="upload-cta">Browse Files</span>
                </>
              )}
              <input
                id="file-upload"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
              />
            </label>
          </div>
        </div>

        {/* ── Submit ── */}
        <button
          type="submit"
          className="primary-btn"
          disabled={loading || !preview}
          id="submit-waste-btn"
        >
          {loading ? (
            <>
              <span style={{
                display: 'inline-block', width: 16, height: 16,
                border: '2px solid rgba(255,255,255,0.4)',
                borderTop: '2px solid white',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite'
              }} />
              AI Analyzing Image…
            </>
          ) : (
            '✨ Upload & Classify'
          )}
        </button>
      </form>
    </div>
  );
}
