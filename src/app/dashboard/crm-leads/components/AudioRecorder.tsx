// src/app/dashboard/crm-leads/components/AudioRecorder.tsx
import React, { useState, useRef, useEffect } from "react";
import { FiTrash2, FiSend } from "react-icons/fi";

interface AudioRecorderProps {
  onSend: (audioBlob: Blob) => void;
  onCancel: () => void;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({ onSend, onCancel }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    startRecording();
    return () => {
      stopRecordingCleanup();
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        onSend(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);

      intervalRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error("Error starting recording:", error);
      alert("No se pudo acceder al micrófono. Por favor verifica tus permisos.");
      onCancel();
    }
  };

  const stopRecordingCleanup = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const handleCancel = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null; // Ignorar el callback de envío
      mediaRecorderRef.current.stop();
    }
    stopRecordingCleanup();
    onCancel();
  };

  const handleSend = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    stopRecordingCleanup();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-4 w-full animate-in fade-in duration-300">
      <button
        type="button"
        onClick={handleCancel}
        className="text-gray-500 hover:text-red-500 transition-colors p-3 sm:p-2 rounded-full hover:bg-gray-100 cursor-pointer"
        title="Cancelar grabación"
      >
        <FiTrash2 size={20} />
      </button>

      <div className="flex-1 flex items-center gap-3 bg-white px-4 py-2 rounded-full border border-red-100 shadow-inner">
        <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
        <span className="text-gray-700 font-mono font-medium">{formatDuration(duration)}</span>
        <span className="text-xs text-gray-400">Grabando audio...</span>
      </div>

      <button
        type="button"
        onClick={handleSend}
        className="bg-green-500 hover:bg-green-600 text-white p-3 sm:p-2 rounded-full shadow-lg transition-transform transform hover:scale-105 cursor-pointer"
        title="Enviar nota de voz"
      >
        <FiSend size={20} />
      </button>
    </div>
  );
};

export default AudioRecorder;
