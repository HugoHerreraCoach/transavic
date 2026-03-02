// src/components/MapInput.tsx
"use client";

import { useState, useRef, useCallback } from "react";
import {
  GoogleMap,
  useLoadScript,
  Marker,
  Autocomplete,
} from "@react-google-maps/api";
import { FiMapPin, FiCheck } from 'react-icons/fi';

const libraries: "places"[] = ["places"];
const mapContainerStyle = {
  height: "300px",
  width: "100%",
  borderRadius: "0.5rem",
};

interface MapInputProps {
  onLocationChange: (lat: number, lng: number) => void;
  onAddressChange?: (address: string) => void;
  initialLat?: number | null;
  initialLng?: number | null;
}

export default function MapInput({
  onLocationChange,
  onAddressChange,
  initialLat,
  initialLng,
}: MapInputProps) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_MAPS_API_KEY || "",
    libraries,
  });

  const limaCenter = { lat: -12.046374, lng: -77.042793 };

  const [marker, setMarker] = useState<{ lat: number; lng: number } | null>(
    initialLat && initialLng ? { lat: initialLat, lng: initialLng } : null,
  );
  const [center, setCenter] = useState(
    initialLat && initialLng
      ? { lat: initialLat, lng: initialLng }
      : limaCenter,
  );
  const [autocomplete, setAutocomplete] =
    useState<google.maps.places.Autocomplete | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  const onLoad = useCallback(
    (autocompleteInstance: google.maps.places.Autocomplete) => {
      setAutocomplete(autocompleteInstance);
    },
    [],
  );

  // Geocodificación inversa: coordenadas → dirección
  const reverseGeocode = useCallback(
    (lat: number, lng: number) => {
      if (!geocoderRef.current) {
        geocoderRef.current = new google.maps.Geocoder();
      }

      geocoderRef.current.geocode(
        { location: { lat, lng } },
        (results, status) => {
          if (status === "OK" && results && results[0]) {
            const address = results[0].formatted_address;
            if (inputRef.current) {
              inputRef.current.value = address;
            }
            onAddressChange?.(address);
          }
        },
      );
    },
    [onAddressChange],
  );

  // Actualizar ubicación y hacer geocodificación inversa
  const updateLocation = useCallback(
    (lat: number, lng: number, shouldGeocode: boolean = true) => {
      setMarker({ lat, lng });
      setCenter({ lat, lng });
      onLocationChange(lat, lng);
      if (shouldGeocode) {
        reverseGeocode(lat, lng);
      }
    },
    [onLocationChange, reverseGeocode],
  );

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
          inputRef.current.value = place.formatted_address || "";
        }
        onAddressChange?.(place.formatted_address || "");
      }
    }
  };

  // Click en el mapa para seleccionar ubicación
  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      const lat = e.latLng?.lat();
      const lng = e.latLng?.lng();
      if (lat !== undefined && lng !== undefined) {
        updateLocation(lat, lng);
      }
    },
    [updateLocation],
  );

  // Arrastrar marcador
  const handleMarkerDragEnd = useCallback(
    (e: google.maps.MapMouseEvent) => {
      const lat = e.latLng?.lat();
      const lng = e.latLng?.lng();
      if (lat !== undefined && lng !== undefined) {
        updateLocation(lat, lng);
      }
    },
    [updateLocation],
  );

  if (loadError) return <div>Error al cargar el mapa</div>;
  if (!isLoaded) return <div>Cargando mapa...</div>;

  const hasLocation = marker !== null;

  return (
    <div className="space-y-3">
      {/* Indicador de estado */}
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
          hasLocation
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-amber-50 text-amber-700 border border-amber-200"
        }`}
      >
        {hasLocation ? (
          <>
            <FiCheck className="flex-shrink-0" />
            <span>
              Ubicación seleccionada • Puedes arrastrar el marcador para ajustar
            </span>
          </>
        ) : (
          <>
            <FiMapPin className="flex-shrink-0" />
            <span>Busca una dirección o haz clic en el mapa</span>
          </>
        )}
      </div>

      {/* Barra de búsqueda */}
      <Autocomplete
        onLoad={onLoad}
        onPlaceChanged={onPlaceChanged}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Busca una dirección..."
          className="w-full p-2 border border-gray-300 rounded-md text-gray-900 font-medium placeholder:text-gray-400 placeholder:font-normal focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
        />
      </Autocomplete>

      {/* Mapa con click y marcador arrastrable */}
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={marker ? 17 : 12}
        onClick={handleMapClick}
        options={{
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        }}
      >
        {marker && (
          <Marker
            position={marker}
            draggable={true}
            onDragEnd={handleMarkerDragEnd}
            animation={typeof google !== 'undefined' ? google.maps.Animation.DROP : undefined}
          />
        )}
      </GoogleMap>

      {/* Hint de interacción */}
      <p className="text-xs text-gray-500 text-center">
        💡 Haz clic en cualquier punto del mapa o arrastra el marcador para
        ubicar exactamente
      </p>
    </div>
  );
}
