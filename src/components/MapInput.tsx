// src/components/MapInput.tsx
'use client';

import { useState, useRef, useCallback } from 'react';
import { GoogleMap, useLoadScript, Marker, Autocomplete } from '@react-google-maps/api';

const libraries: ('places')[] = ['places'];
const mapContainerStyle = {
  height: '300px',
  width: '100%',
  borderRadius: '0.5rem',
};

interface MapInputProps {
  onLocationChange: (lat: number, lng: number) => void;
  initialLat?: number | null;
  initialLng?: number | null;
}

export default function MapInput({ onLocationChange, initialLat, initialLng }: MapInputProps) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_MAPS_API_KEY || '',
    libraries,
  });

  const limaCenter = { lat: -12.046374, lng: -77.042793 };

  const [marker, setMarker] = useState<{ lat: number; lng: number } | null>(
    initialLat && initialLng ? { lat: initialLat, lng: initialLng } : null
  );
  const [center, setCenter] = useState(
    initialLat && initialLng ? { lat: initialLat, lng: initialLng } : limaCenter
  );

  const [autocomplete, setAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onLoad = useCallback((autocompleteInstance: google.maps.places.Autocomplete) => {
    setAutocomplete(autocompleteInstance);
  }, []);

  const onPlaceChanged = () => {
    if (autocomplete) {
      const place = autocomplete.getPlace();
      if (place && place.geometry && place.geometry.location) {
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        setMarker({ lat, lng });
        setCenter({ lat, lng });
        onLocationChange(lat, lng);
        if (inputRef.current) {
          inputRef.current.value = place.formatted_address || '';
        }
      }
    }
  };

  if (loadError) return <div>Error al cargar el mapa</div>;
  if (!isLoaded) return <div>Cargando mapa...</div>;

  return (
    <div className="space-y-4">
      <Autocomplete
        onLoad={onLoad}
        onPlaceChanged={onPlaceChanged}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Busca una dirección..."
          className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
        />
      </Autocomplete>
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={marker ? 17 : 12} 
      >
        {marker && <Marker position={marker} />}
      </GoogleMap>
    </div>
  );
}
