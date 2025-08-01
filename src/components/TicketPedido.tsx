// src/components/TicketPedido.tsx 

import { Ref } from 'react';
import {
    FiUser, FiPhone, FiMapPin, FiMap, FiClipboard, FiClock, FiEdit2, FiStar, FiArchive
} from 'react-icons/fi';

export interface TicketDisplayData {
    cliente: string;
    whatsapp?: string | null;
    direccion?: string | null;
    distrito: string;
    tipo_cliente?: string;
    tipoCliente?: string;
    detalle: string;
    hora_entrega?: string | null;
    horaEntrega?: string;
    notas?: string | null;
    empresa: string;
    fecha?: string;
    detalle_final?: string | null;
}

interface TicketPedidoProps {
    datos: TicketDisplayData;
    referencia?: Ref<HTMLDivElement>;
    logoDataUrl: string | null;
    onLogoReady: () => void;
}

const TicketPedido: React.FC<TicketPedidoProps> = ({ datos, referencia, logoDataUrl, onLogoReady }) => (
    <div ref={referencia} className="bg-white p-8 border-2 border-gray-300 rounded-lg text-black w-full">
        <div className="text-center pb-4 border-b-2 border-dashed">
            {logoDataUrl && (
                <img
                    id="ticket-logo"
                    src={logoDataUrl}
                    alt="Logo de la empresa"
                    className="w-[120px] h-auto mx-auto"
                    style={{ display: 'block' }}
                    crossOrigin="anonymous"
                    onLoad={onLogoReady}
                    onError={(e) => console.error('Error al cargar imagen en ticket:', e)}
                />
            )}
            <h1 className="text-3xl font-bold text-red-600">{datos.empresa === 'Transavic' ? 'PEDIDO TRANSAVIC' : 'PEDIDO AVÍCOLA DE TONY'}</h1>
            {/* ✅ CORRECCIÓN: Usamos el formato de fecha que ya viene del dashboard */}
            <p className="text-center text-gray-600 text-md mt-2 font-semibold">{datos.fecha}</p>
        </div>
        <div className="mt-6 space-y-4 text-lg">
            {/* ✅ CORRECCIÓN: Se renderiza siempre la fila, y el valor se muestra si existe */}
            <div className="flex items-start"><FiUser className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} /><p className="flex-1 min-w-0"><span className="font-semibold mr-2">Cliente:</span><span className="break-words">{datos.cliente || ''}</span></p></div>
            <div className="flex items-start"><FiPhone className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} /><p className="flex-1 min-w-0"><span className="font-semibold mr-2">WhatsApp:</span><span className="break-words">{datos.whatsapp || ''}</span></p></div>
            <div className="flex items-start"><FiMapPin className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} /><p className="flex-1 min-w-0"><span className="font-semibold mr-2">Dirección:</span><span className="break-words">{datos.direccion || ''}</span></p></div>
            <div className="flex items-start"><FiMap className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} /><p className="flex-1 min-w-0"><span className="font-semibold mr-2">Distrito:</span><span className="break-words">{datos.distrito || ''}</span></p></div>
            <div className="flex items-start"><FiStar className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} /><p className="flex-1 min-w-0"><span className="font-semibold mr-2">Tipo de cliente:</span><span className="break-words">{datos.tipo_cliente || datos.tipoCliente || ''}</span></p></div>
            <div className="pt-4 border-t border-dashed"><div className="flex items-start"><FiClipboard className="mr-3 text-gray-600 mt-1 flex-shrink-0" size={20} /><p className="flex-1 min-w-0"><span className="font-semibold mr-2">Detalle:</span><span className="whitespace-pre-wrap break-words">{datos.detalle || ''}</span></p></div></div>

            {/* El campo de peso exacto sigue siendo condicional, lo cual es correcto */}
            {datos.detalle_final && (
                <div className="pt-4 border-t border-dashed">
                    <div className="flex items-start text-red-700 font-bold">
                        <FiArchive className="mr-3 mt-1 flex-shrink-0" size={20} />
                        <p className="flex-1 min-w-0">
                            <span className="mr-2">Detalle Final:</span>
                            <span className="whitespace-pre-wrap break-words">{datos.detalle_final}</span>
                        </p>
                    </div>
                </div>
            )}

            <div className="flex items-start"><FiClock className="mr-3 text-gray-600 flex-shrink-0 mt-1" size={20} /><p className="flex-1 min-w-0"><span className="font-semibold mr-2">Horario de entrega:</span><span className="break-words">{datos.hora_entrega || datos.horaEntrega || ''}</span></p></div>
            <div className="flex items-start"><FiEdit2 className="mr-3 text-gray-600 mt-1 flex-shrink-0" size={20} /><p className="flex-1 min-w-0"><span className="font-semibold mr-2">Notas:</span><span className="whitespace-pre-wrap break-words">{datos.notas || ''}</span></p></div>
        </div>
    </div>
);

export default TicketPedido;