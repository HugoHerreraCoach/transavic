// src/app/dashboard/crm-leads/components/QuickReplySelector.tsx
import React from "react";
import { FiImage, FiVideo, FiFileText, FiZap } from "react-icons/fi";

interface QuickReply {
  id: string;
  title: string;
  shortcut: string;
  text: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "document" | "dynamic_card";
}

interface QuickReplySelectorProps {
  replies: QuickReply[];
  filterText: string;
  onSelect: (reply: QuickReply) => void;
  onClose: () => void;
  selectedIndex: number;
}

export default function QuickReplySelector({
  replies,
  filterText,
  onSelect,
  onClose,
  selectedIndex,
}: QuickReplySelectorProps) {
  const itemsRef = React.useRef<(HTMLButtonElement | null)[]>([]);

  const filtered = replies;

  React.useEffect(() => {
    if (itemsRef.current[selectedIndex]) {
      itemsRef.current[selectedIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div className="fixed bottom-[64px] left-0 right-0 z-40 bg-slate-900 border-t border-slate-700 sm:absolute sm:bottom-full sm:left-0 sm:right-auto sm:mb-2 sm:rounded-xl sm:shadow-2xl sm:w-[500px] sm:bg-slate-900 sm:border sm:border-slate-700 flex flex-row overflow-x-auto sm:flex-col sm:overflow-y-auto sm:max-h-80 select-none">
      <div className="hidden sm:flex items-center justify-between p-2.5 bg-slate-800 border-b border-slate-700 sticky top-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-indigo-400 flex items-center gap-1">
            <FiZap size={12} className="fill-current" /> Respuestas Rápidas
          </span>
          <span className="text-[10px] text-slate-400">{filtered.length} coincidencias</span>
        </div>
      </div>

      <div className="p-2 sm:p-1 flex sm:block gap-2 min-w-max sm:min-w-0">
        {filtered.map((reply, index) => (
          <button
            key={reply.id}
            type="button"
            ref={(el) => {
              itemsRef.current[index] = el;
            }}
            onClick={() => onSelect(reply)}
            className={`w-48 sm:w-full text-left p-2 rounded-lg group transition-colors flex flex-col gap-1 border flex-shrink-0 sm:flex-shrink cursor-pointer
              ${
                index === selectedIndex
                  ? "bg-slate-800 border-slate-600"
                  : "bg-slate-800/50 sm:bg-transparent border-slate-700 sm:border-transparent hover:bg-slate-800 hover:border-slate-700"
              }
            `}
          >
            <div className="flex items-start justify-between gap-3 w-full">
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center justify-between w-full mb-0.5">
                  <span className="font-bold text-indigo-400 text-xs font-mono">/{reply.shortcut}</span>
                </div>
                <div className="text-[11px] text-slate-300 truncate w-full">{reply.text}</div>

                {reply.mediaType && (
                  <div className="flex items-center gap-1 mt-1">
                    {reply.mediaType === "image" && <FiImage size={10} className="text-purple-400" />}
                    {reply.mediaType === "video" && <FiVideo size={10} className="text-purple-400" />}
                    {reply.mediaType === "document" && <FiFileText size={10} className="text-purple-400" />}
                    <span className="text-[9px] text-purple-400">Adjunto incluido</span>
                  </div>
                )}
              </div>

              {reply.mediaType === "image" && reply.mediaUrl && (
                <div className="h-10 w-10 shrink-0 rounded bg-slate-800 border border-slate-700 overflow-hidden self-center">
                  <img src={reply.mediaUrl} alt="Preview" className="h-full w-full object-cover" />
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
