'use client';

import { useState, useEffect } from 'react';
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

    useEffect(() => {
        if (userToEdit) {
            setName(userToEdit.name);
            setRole(userToEdit.role as 'asesor' | 'repartidor' | 'admin' | 'produccion');
            setPassword(''); // La contraseña siempre se limpia al editar
        } else {
            setName('');
            setPassword('');
            setRole('asesor');
        }
    }, [userToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const userData: Partial<User> & { password?: string } = {
            id: userToEdit?.id,
            name: name.trim(),
            role,
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
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-xl w-full max-w-md anim-modal"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
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
                <form onSubmit={handleSubmit}>
                    <div className="px-6 py-5 space-y-4">
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
                    </div>
                    <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
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
