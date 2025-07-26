'use client';

import { useState, useEffect } from 'react';
import { User } from '@/lib/types';
import { FiX } from 'react-icons/fi';

interface UserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (user: Partial<User> & { password?: string }) => void;
    userToEdit?: User | null;
    isLoading: boolean;
}

export default function UserModal({ isOpen, onClose, onSave, userToEdit, isLoading }: UserModalProps) {
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'admin' | 'asesor' | 'repartidor'>('asesor');

    useEffect(() => {
        if (userToEdit) {
            setName(userToEdit.name);
            setRole(userToEdit.role as 'asesor' | 'repartidor' | 'admin');
            setPassword(''); // La contraseña siempre se limpia al editar
        } else {
            // Resetear para el modo de creación
            setName('');
            setPassword('');
            setRole('asesor');
        }
    }, [userToEdit, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const userData: Partial<User> & { password?: string } = {
            id: userToEdit?.id,
            name,
            role,
        };
        if (password) {
            userData.password = password;
        }
        onSave(userData);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">{userToEdit ? 'Editar Usuario' : 'Crear Nuevo Usuario'}</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800"><FiX size={24} /></button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700">Nombre de Usuario</label>
                            <input type="text" id="name" value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700">Contraseña</label>
                            <input type="password" id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={userToEdit ? 'Dejar en blanco para no cambiar' : ''} required={!userToEdit} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
                        </div>
                        <div>
                            <label htmlFor="role" className="block text-sm font-medium text-gray-700">Rol</label>
                            <select id="role" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'asesor' | 'repartidor')} className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                                <option value="asesor">Asesor</option>
                                <option value="repartidor">Repartidor</option>
                                <option value="admin">Administrador</option>
                            </select>
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end gap-3">
                        <button type="button" onClick={onClose} disabled={isLoading} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300 disabled:opacity-50 cursor-pointer">Cancelar</button>
                        <button type="submit" disabled={isLoading} className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:bg-blue-300 cursor-pointer">{isLoading ? 'Guardando...' : 'Guardar'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}