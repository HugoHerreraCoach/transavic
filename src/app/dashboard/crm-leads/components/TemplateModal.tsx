// src/app/dashboard/crm-leads/components/TemplateModal.tsx
import React, { useState, useEffect } from "react";
import { FiX, FiFileText, FiSend, FiLoader } from "react-icons/fi";

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (
    templateName: string,
    language?: string,
    variables?: string[],
    file?: File,
    mediaType?: string,
    previewText?: string
  ) => Promise<void>;
  leadName?: string;
  userName?: string;
  /** Marca a la que escribió el cliente: filtra las plantillas que se ofrecen. */
  empresa?: string;
}

interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  /**
   * Marca dueña de la plantilla. Ausente = sirve para las dos.
   * Las plantillas REALES viven en Meta por cuenta de WhatsApp: dos marcas pueden
   * tener una plantilla con el mismo `name` y textos distintos, y cada una se
   * resuelve en su propia cuenta al enviarla.
   */
  empresa?: string;
  components: {
    type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
    format?: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO";
    text?: string;
    buttons?: unknown[];
  }[];
}

const DEFAULT_TEMPLATES: WhatsAppTemplate[] = [
  {
    id: "saludo_personalizado_tra",
    name: "saludo_personalizado",
    language: "es",
    status: "APPROVED",
    category: "UTILITY",
    empresa: "Transavic",
    components: [
      {
        type: "BODY",
        text: "¡Hola {{1}}! Te saluda {{2}} del equipo comercial de Transavic. Es un gusto saludarte. ¿En qué te podemos ayudar hoy?",
      },
    ],
  },
  {
    id: "saludo_personalizado_avi",
    name: "saludo_personalizado",
    language: "es",
    status: "APPROVED",
    category: "UTILITY",
    empresa: "Avícola de Tony",
    components: [
      {
        type: "BODY",
        text: "¡Hola {{1}}! Te saluda {{2}} del equipo comercial de La Avícola de Tony. Es un gusto saludarte. ¿En qué te podemos ayudar hoy?",
      },
    ],
  },
  {
    id: "confirmacion_pedido",
    name: "confirmacion_pedido",
    language: "es",
    status: "APPROVED",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "¡Hola {{1}}! Queremos confirmarte que tu pedido ha sido registrado con éxito para despacho. Si tienes alguna duda, puedes responder a este mensaje. ¡Gracias por tu preferencia!",
      },
    ],
  },
];

export default function TemplateModal({
  isOpen,
  onClose,
  onSend,
  leadName = "",
  userName = "",
  empresa,
}: TemplateModalProps) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>(DEFAULT_TEMPLATES);
  const [selectedTemplate, setSelectedTemplate] = useState("saludo_personalizado");

  // Solo las plantillas de la marca del lead (más las que no declaran marca).
  // Sin esto, a un cliente de una marca se le podía ofrecer el texto de la otra.
  const plantillasVisibles = React.useMemo(
    () => templates.filter((t) => !t.empresa || !empresa || t.empresa === empresa),
    [templates, empresa]
  );
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Variables state
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [requiredVars, setRequiredVars] = useState<string[]>([]);
  const [selectedTemplateData, setSelectedTemplateData] = useState<WhatsAppTemplate | null>(null);

  // Fetch templates from settings or use default
  useEffect(() => {
    if (!isOpen) return;

    const fetchTemplates = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.crm_whatsapp_templates && data.crm_whatsapp_templates.length > 0) {
            setTemplates(data.crm_whatsapp_templates);
          } else {
            // Guardar por defecto si no existen
            await fetch("/api/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                key: "crm_whatsapp_templates",
                value: DEFAULT_TEMPLATES,
              }),
            });
            setTemplates(DEFAULT_TEMPLATES);
          }
        }
      } catch (e) {
        console.error("Error al cargar plantillas:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchTemplates();
  }, [isOpen]);

  // Si la plantilla elegida no pertenece a esta marca, caer en la primera visible.
  useEffect(() => {
    if (plantillasVisibles.length === 0) return;
    if (!plantillasVisibles.some((t) => t.name === selectedTemplate)) {
      setSelectedTemplate(plantillasVisibles[0].name);
    }
  }, [plantillasVisibles, selectedTemplate]);

  // Parse required variables on template change
  useEffect(() => {
    const template = plantillasVisibles.find((t) => t.name === selectedTemplate);
    if (template) {
      setSelectedTemplateData(template);
      const bodyComp = template.components.find((c) => c.type === "BODY");
      if (bodyComp && bodyComp.text) {
        const matches = bodyComp.text.match(/{{(\d+)}}/g);
        if (matches) {
          const nums = [...new Set(matches.map((m) => m.replace(/{{|}}/g, "")))].sort();
          setRequiredVars(nums);

          // Auto-fill variables based on template name
          const initialVars: Record<string, string> = {};
          nums.forEach((num) => {
            if (num === "1") initialVars["1"] = leadName.split(" ")[0]; // First name
            else if (num === "2") initialVars["2"] = userName.split(" ")[0]; // Adviser name
            else initialVars[num] = "";
          });
          setVariables(initialVars);
        } else {
          setRequiredVars([]);
          setVariables({});
        }
      } else {
        setRequiredVars([]);
        setVariables({});
      }
    } else {
      setSelectedTemplateData(null);
      setRequiredVars([]);
      setVariables({});
    }
  }, [selectedTemplate, plantillasVisibles, leadName, userName]);

  const handleSend = async () => {
    setSending(true);
    try {
      // Reemplazar variables en el cuerpo para la previsualización local
      let previewText = selectedTemplateData?.components.find((c) => c.type === "BODY")?.text || "";
      const varList: string[] = [];

      requiredVars.forEach((num) => {
        const val = variables[num] || "";
        previewText = previewText.replace(`{{${num}}}`, val);
        varList.push(val);
      });

      await onSend(selectedTemplate, selectedTemplateData?.language || "es", varList, undefined, undefined, previewText);
      onClose();
    } catch (e) {
      console.error(e);
      alert("Error al enviar plantilla.");
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs select-none">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50/50 shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-1.5">
            💬 Enviar Plantilla Oficial WhatsApp
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer">
            <FiX size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {loading ? (
            <div className="flex justify-center items-center py-10">
              <FiLoader className="animate-spin text-indigo-600 text-lg" />
            </div>
          ) : (
            <>
              {/* Select Template */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Seleccionar Plantilla</label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value)}
                  className="w-full border border-gray-200 bg-white rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {plantillasVisibles.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name} ({t.language.toUpperCase()})
                    </option>
                  ))}
                </select>
                {empresa && (
                  <p className="text-[10px] text-gray-400 pt-0.5">
                    Se enviará desde el número de <span className="font-bold text-gray-500">{empresa}</span>.
                    La plantilla debe existir aprobada en esa cuenta de WhatsApp.
                  </p>
                )}
                {plantillasVisibles.length === 0 && (
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    No hay plantillas registradas para {empresa}. Créalas en su cuenta de WhatsApp y
                    agrégalas aquí antes de enviar.
                  </p>
                )}
              </div>

              {/* Dynamic Variables Inputs */}
              {requiredVars.length > 0 && (
                <div className="p-3 bg-gray-50 rounded-2xl space-y-3">
                  <span className="font-bold text-gray-700 block">Variables de Mensaje</span>
                  <div className="space-y-2">
                    {requiredVars.map((num) => (
                      <div key={num} className="flex items-center gap-2">
                        <span className="font-bold text-gray-400 w-8">{"{{" + num + "}}"}</span>
                        <input
                          type="text"
                          required
                          value={variables[num] || ""}
                          onChange={(e) => setVariables({ ...variables, [num]: e.target.value })}
                          placeholder={`Texto para la variable ${num}`}
                          className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1 bg-white text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live Preview Bubble */}
              {selectedTemplateData && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Vista Previa</span>
                  <div className="p-3 bg-[#e1f3fc] border border-[#d2ecfa] rounded-2xl text-[11px] text-gray-800 leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {(() => {
                      let text = selectedTemplateData.components.find((c) => c.type === "BODY")?.text || "";
                      requiredVars.forEach((num) => {
                        text = text.replace(`{{${num}}}`, variables[num] || `{{${num}}}`);
                      });
                      return text;
                    })()}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 border-t border-gray-100 bg-gray-50 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-50 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleSend}
            disabled={sending || loading || plantillasVisibles.length === 0}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <FiSend size={12} /> {sending ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
