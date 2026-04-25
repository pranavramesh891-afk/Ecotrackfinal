import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = 'http://localhost:5001/api';

export default function RecyclingCenters() {
  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locationWarning, setLocationWarning] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let userLocation = { lat: 40.7128, lng: -74.0060 }; // Default NYC fallback
    
    const fetchCenters = (loc) => {
      // Future scope: pass `loc` coordinate parameters into the backend search query
      fetch(`${API_URL}/recycling`)
        .then(res => res.json())
        .then(json => {
          if (json) setCenters(json);
          setLoading(false);
        })
        .catch(err => {
          console.error('Recycling error:', err);
          setLoading(false);
        });
    };

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          fetchCenters(userLocation);
        },
        (err) => {
          console.warn("Geolocation denied or unavailable.", err);
          setLocationWarning("Location access denied. Using default location (New York).");
          fetchCenters(userLocation);
        },
        { timeout: 4000 }
      );
    } else {
      setLocationWarning("Location access denied. Using default location (New York).");
      fetchCenters(userLocation);
    }
  }, []);

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        <p className="loading-text">Finding nearby centers…</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <p className="page-title">Recycle Centers</p>
      <p className="page-subtitle">Drop off your packaging at these verified locations.</p>

      {locationWarning && (
        <div className="status-msg status-error mb-4" style={{ fontSize: '0.9rem' }}>
          ⚠️ {locationWarning}
        </div>
      )}

      {centers.length > 0 ? (
        <div className="centers-list">
          {centers.map(center => (
            <div
              key={center.id}
              className="center-card"
              onClick={() => navigate(`/center/${center.id}`)}
              id={`center-${center.id}`}
            >
              <div className="center-card-icon">🏭</div>
              <div className="center-card-info">
                <div className="center-card-name">{center.name}</div>
                <div className="center-card-sub">✓ Verified Partner</div>
              </div>
              <div className="distance-badge">{center.distance}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">📍</div>
          <p className="empty-text">No recycling centers found nearby.<br />Check back soon!</p>
        </div>
      )}
    </div>
  );
}
