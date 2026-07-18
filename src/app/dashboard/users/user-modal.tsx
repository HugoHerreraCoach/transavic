'use client';

import { useState, useEffect, useRef } from 'react';
import { User } from '@/lib/types';
import { FiX, FiRefreshCw } from 'react-icons/fi';

interface UserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (user: Partial<User> & { password?: string }) => void;
    userToEdit?: User | null;
    isLoading: boolean;
}

const INPUT_CLS =
    'mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-200';

export default function UserModal({ isOpen, onClose, onSave, userToEdit, isLoading }: UserModalProps) {
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'admin' | 'asesor' | 'repartidor' | 'produccion'>('asesor');
    const [choferDni, setChoferDni] = useState('');
    const [choferLicencia, setChoferLicencia] = useState('');
    const [vehiculoPlaca, setVehiculoPlaca] = useState('');
    const [choferNombres, setChoferNombres] = useState('');
    const [choferApellidos, setChoferApellidos] = useState('');
    const [soloLectura, setSoloLectura] = useState(false);
    const isMouseDownInside = useRef(true);

    useEffect(() => {
        if (userToEdit) {
            setName(userToEdit.name);
            setRole(userToEdit.role as 'asesor' | 'repartidor' | 'admin' | 'produccion');
            setPassword(''); // La contraseña siempre se limpia al editar
            setChoferDni(userToEdit.chofer_dni || '');
            setChoferLicencia(userToEdit.chofer_licencia || '');
            setVehiculoPlaca(userToEdit.vehiculo_placa || '');
            setChoferNombres(userToEdit.chofer_nombres || '');
            setChoferApellidos(userToEdit.chofer_apellidos || '');
            setSoloLectura(Boolean(userToEdit.solo_lectura));
        } else {
            setName('');
            setPassword('');
            setRole('asesor');
            setChoferDni('');
            setChoferLicencia('');
            setVehiculoPlaca('');
            setChoferNombres('');
            setChoferApellidos('');
            setSoloLectura(false);
        }
    }, [userToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const userData: Partial<User> & { password?: string } = {
            id: userToEdit?.id,
            name: name.trim(),
            role,
            chofer_dni: role === 'repartidor' ? choferDni.trim() || null : null,
            chofer_licencia: role === 'repartidor' ? choferLicencia.trim() || null : null,
            vehiculo_placa: role === 'repartidor' ? vehiculoPlaca.trim() || null : null,
            chofer_nombres: role === 'repartidor' ? choferNombres.trim() || null : null,
            chofer_apellidos: role === 'repartidor' ? choferApellidos.trim() || null : null,
            solo_lectura: soloLectura,
        };
        if (password) {
            userData.password = password;
        }
        onSave(userData);
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/50 z-50 flex justify-center items-center p-4 anim-fade"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                    isMouseDownInside.current = false;
                } else {
                    isMouseDownInside.current = true;
                }
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget && !isMouseDownInside.current) {
                    onClose();
                }
                isMouseDownInside.current = true;
            }}
        >
            <div
                className="bg-white rounded-2xl shadow-xl w-full max-w-md anim-modal max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 flex-shrink-0">
                    <h2 className="text-lg font-bold text-gray-800">
                        {userToEdit ? 'Editar usuario' : 'Nuevo usuario'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-700 transition-colors"
                        aria-label="Cerrar"
                    >
                        <FiX size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                    <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                                Nombre
                            </label>
                            <input
                                type="text"
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                autoFocus
                                placeholder="Ej. María Pérez"
                                className={INPUT_CLS}
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                                Contraseña
                            </label>
                            <input
                                type="password"
                                id="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={userToEdit ? 'Déjala en blanco para no cambiarla' : 'Mínimo 6 caracteres'}
                                required={!userToEdit}
                                className={INPUT_CLS}
                            />
                            {userToEdit && (
                                <p className="text-xs text-gray-400 mt-1">
                                    Solo escríbela si quieres cambiar la contraseña actual.
                                </p>
                            )}
                        </div>
                        <div>
                            <label htmlFor="role" className="block text-sm font-medium text-gray-700">
                                Rol
                            </label>
                            <select
                                id="role"
                                value={role}
                                onChange={(e) =>
                                    setRole(e.target.value as 'admin' | 'asesor' | 'repartidor' | 'produccion')
                                }
                                className={INPUT_CLS}
                            >
                                <option value="asesor">Asesora (vende y registra pedidos)</option>
                                <option value="repartidor">Repartidor (entrega su ruta)</option>
                                <option value="produccion">Producción (pesa y prepara)</option>
                                <option value="admin">Administrador (acceso total)</option>
                            </select>
                        </div>

                        <div className="p-4 bg-indigo-50/60 border border-indigo-100 rounded-xl">
                            <label htmlFor="soloLectura" className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    id="soloLectura"
                                    checked={soloLectura}
                                    onChange={(e) => setSoloLectura(e.target.checked)}
                                    className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>
                                    <span className="block text-sm font-semibold text-gray-800">Solo lectura</span>
                                    <span className="block text-xs text-gray-500 leading-snug">
                                        Puede ver todo lo de su rol, pero no crear, editar ni eliminar nada.
                                        Para un observador que revise todo el sistema: elige <b>Administrador</b> y marca esta opción.
                                        El cambio aplica cuando el usuario vuelve a iniciar sesión.
                                    </span>
                                </span>
                            </label>
                        </div>

                        {role === 'repartidor' && (
                            <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl space-y-3 mt-4">
                                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                                    Datos de Conductor (SUNAT) · opcional
                                </h3>
                                <p className="text-[11px] text-gray-500 leading-snug -mt-1">
                                    Puedes dejarlos en blanco y completarlos después. Al emitir una guía de
                                    remisión se piden si hacen falta (con moto o auto ligero no son necesarios).
                                    Varios repartidores pueden tener la misma placa.
                                </p>
                                <div>
                                    <label htmlFor="choferNombres" className="block text-xs font-medium text-gray-600">
                                        Nombres del Conductor
                                    </label>
                                    <input
                                        type="text"
                                        id="choferNombres"
                                        value={choferNombres}
                                        onChange={(e) => setChoferNombres(e.target.value)}
                                        placeholder="Ej. Juan Carlos"
                                        className={INPUT_CLS}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="choferApellidos" className="block text-xs font-medium text-gray-600">
                                        Apellidos del Conductor
                                    </label>
                                    <input
                                        type="text"
                                        id="choferApellidos"
                                        value={choferApellidos}
                                        onChange={(e) => setChoferApellidos(e.target.value)}
                                        placeholder="Ej. Pérez Gómez"
                                        className={INPUT_CLS}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="choferDni" className="block text-xs font-medium text-gray-600">
                                        DNI del Conductor
                                    </label>
                                    <input
                                        type="text"
                                        id="choferDni"
                                        value={choferDni}
                                        onChange={(e) => setChoferDni(e.target.value)}
                                        placeholder="Ej. 70443212"
                                        className={INPUT_CLS}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="choferLicencia" className="block text-xs font-medium text-gray-600">
                                        Licencia de Conducir
                                    </label>
                                    <input
                                        type="text"
                                        id="choferLicencia"
                                        value={choferLicencia}
                                        onChange={(e) => setChoferLicencia(e.target.value)}
                                        placeholder="Ej. Q20384812"
                                        className={INPUT_CLS}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="vehiculoPlaca" className="block text-xs font-medium text-gray-600">
                                        Placa del Vehículo
                                    </label>
                                    <input
                                        type="text"
                                        id="vehiculoPlaca"
                                        value={vehiculoPlaca}
                                        onChange={(e) => setVehiculoPlaca(e.target.value)}
                                        placeholder="Ej. C1A-098"
                                        className={INPUT_CLS}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 flex-shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isLoading}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors active:scale-[0.97]"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2 transition-colors active:scale-[0.97]"
                        >
                            {isLoading && <FiRefreshCw className="h-4 w-4 animate-spin" />}
                            {isLoading ? 'Guardando…' : 'Guardar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
