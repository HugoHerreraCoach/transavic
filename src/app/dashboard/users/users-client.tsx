// src/app/dashboard/users/users-client.tsx
'use client';

import { useState } from 'react';
import { User } from '@/lib/types';
import {
    FiPlus,
    FiEdit2,
    FiTrash2,
    FiShield,
    FiBriefcase,
    FiTruck,
    FiPackage,
    FiAlertTriangle,
    FiRefreshCw,
} from 'react-icons/fi';
import UserModal from './user-modal';

interface UsersClientPageProps {
    initialUsers: User[];
}

// Identidad visual por rol: etiqueta legible, color de badge, color de avatar e ícono.
const ROL_UI: Record<
    string,
    { label: string; plural: string; badge: string; avatar: string; icon: React.ReactNode }
> = {
    admin: {
        label: 'Administrador',
        plural: 'Administradores',
        badge: 'bg-gray-100 text-gray-700 border-gray-200',
        avatar: 'bg-gray-700',
        icon: <FiShield className="h-3 w-3" />,
    },
    asesor: {
        label: 'Asesora',
        plural: 'Asesoras',
        badge: 'bg-blue-50 text-blue-700 border-blue-200',
        avatar: 'bg-blue-500',
        icon: <FiBriefcase className="h-3 w-3" />,
    },
    repartidor: {
        label: 'Repartidor',
        plural: 'Repartidores',
        badge: 'bg-green-50 text-green-700 border-green-200',
        avatar: 'bg-green-600',
        icon: <FiTruck className="h-3 w-3" />,
    },
    produccion: {
        label: 'Producción',
        plural: 'Producción',
        badge: 'bg-amber-50 text-amber-700 border-amber-200',
        avatar: 'bg-amber-500',
        icon: <FiPackage className="h-3 w-3" />,
    },
};
const ROL_FALLBACK = {
    label: 'Sin rol',
    plural: 'Sin rol',
    badge: 'bg-gray-100 text-gray-500 border-gray-200',
    avatar: 'bg-gray-400',
    icon: null,
};
const rolUI = (rol: string) => ROL_UI[rol] ?? ROL_FALLBACK;
const ORDEN_ROLES = ['admin', 'asesor', 'repartidor', 'produccion'];

export default function UsersClientPage({ initialUsers }: UsersClientPageProps) {
    const [users, setUsers] = useState<User[]>(initialUsers);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [userToEdit, setUserToEdit] = useState<User | null>(null);
    const [userToDelete, setUserToDelete] = useState<User | null>(null);
    const [toast, setToast] = useState<{ tipo: 'ok' | 'error'; txt: string } | null>(null);

    const aviso = (tipo: 'ok' | 'error', txt: string) => {
        setToast({ tipo, txt });
        setTimeout(() => setToast(null), 3500);
    };

    const handleOpenCreateModal = () => {
        setUserToEdit(null);
        setIsModalOpen(true);
    };
    const handleOpenEditModal = (user: User) => {
        setUserToEdit(user);
        setIsModalOpen(true);
    };
    const handleCloseModal = () => {
        setIsModalOpen(false);
        setUserToEdit(null);
    };

    const handleSaveUser = async (userData: Partial<User> & { password?: string }) => {
        setLoading(true);
        const isEditing = !!userData.id;
        const url = isEditing ? `/api/users/${userData.id}` : '/api/users';
        const method = isEditing ? 'PATCH' : 'POST';
        try {
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'No se pudo guardar el usuario.');
            }
            const savedUser = await response.json();
            if (isEditing) {
                setUsers(users.map((u) => (u.id === savedUser.id ? savedUser : u)));
                aviso('ok', 'Usuario actualizado.');
            } else {
                setUsers([...users, savedUser]);
                aviso('ok', 'Usuario creado.');
            }
            handleCloseModal();
        } catch (error) {
            aviso('error', error instanceof Error ? error.message : 'Ocurrió un problema.');
        } finally {
            setLoading(false);
        }
    };

    const confirmDelete = async () => {
        if (!userToDelete) return;
        setLoading(true);
        try {
            const response = await fetch(`/api/users/${userToDelete.id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('No se pudo eliminar el usuario.');
            setUsers(users.filter((u) => u.id !== userToDelete.id));
            aviso('ok', 'Usuario eliminado.');
            setUserToDelete(null);
        } catch (error) {
            aviso('error', error instanceof Error ? error.message : 'Ocurrió un problema.');
        } finally {
            setLoading(false);
        }
    };

    // Conteo por rol para el panorama.
    const conteo = ORDEN_ROLES.map((r) => ({
        rol: r,
        n: users.filter((u) => u.role === r).length,
    })).filter((c) => c.n > 0);

    return (
        <div>
            {/* Panorama: cuántos usuarios por rol */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
                {conteo.map(({ rol, n }) => {
                    const ui = rolUI(rol);
                    return (
                        <span
                            key={rol}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${ui.badge}`}
                        >
                            {ui.icon}
                            <span className="tabular-nums font-semibold">{n}</span>{' '}
                            {n === 1 ? ui.label : ui.plural}
                        </span>
                    );
                })}
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex justify-between items-center gap-3 px-5 py-4 border-b border-gray-100">
                    <h2 className="text-base font-bold text-gray-800">
                        {users.length} {users.length === 1 ? 'usuario' : 'usuarios'}
                    </h2>
                    <button
                        onClick={handleOpenCreateModal}
                        className="bg-red-600 text-white px-3.5 py-2 rounded-lg hover:bg-red-700 flex items-center gap-1.5 text-sm font-medium transition-colors active:scale-[0.97]"
                    >
                        <FiPlus className="h-4 w-4" />
                        Nuevo usuario
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                                <th className="text-left font-semibold px-5 py-2.5">Usuario</th>
                                <th className="text-left font-semibold px-5 py-2.5">Rol</th>
                                <th className="text-right font-semibold px-5 py-2.5">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {users.map((user) => {
                                const ui = rolUI(user.role);
                                const nombre = user.name.trim();
                                return (
                                    <tr key={user.id} className="hover:bg-gray-50/70 transition-colors">
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-3">
                                                <span
                                                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${ui.avatar}`}
                                                >
                                                    {nombre.charAt(0).toUpperCase()}
                                                </span>
                                                <span className="font-medium text-gray-800">{nombre}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3">
                                            <span
                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${ui.badge}`}
                                            >
                                                {ui.icon}
                                                {ui.label}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleOpenEditModal(user)}
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors active:scale-95"
                                                >
                                                    <FiEdit2 className="h-3.5 w-3.5" />
                                                    Editar
                                                </button>
                                                <button
                                                    onClick={() => setUserToDelete(user)}
                                                    title="Eliminar usuario"
                                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors active:scale-95"
                                                >
                                                    <FiTrash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {users.length === 0 && (
                                <tr>
                                    <td colSpan={3} className="px-5 py-10 text-center text-gray-400">
                                        No hay usuarios todavía.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <UserModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSave={handleSaveUser}
                userToEdit={userToEdit}
                isLoading={loading}
            />

            {/* Confirmación de borrado (reemplaza el confirm() nativo) */}
            {userToDelete && (
                <div
                    className="fixed inset-0 bg-black/50 z-50 flex justify-center items-center p-4 anim-fade"
                    onClick={() => !loading && setUserToDelete(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 anim-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3">
                            <span className="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
                                <FiAlertTriangle className="h-4 w-4" />
                            </span>
                            <div>
                                <h3 className="font-bold text-gray-800">
                                    ¿Eliminar a {userToDelete.name.trim()}?
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    Perderá el acceso al sistema. Esta acción no se puede deshacer.
                                </p>
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                onClick={() => setUserToDelete(null)}
                                disabled={loading}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors active:scale-[0.97]"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmDelete}
                                disabled={loading}
                                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2 transition-colors active:scale-[0.97]"
                            >
                                {loading && <FiRefreshCw className="h-4 w-4 animate-spin" />}
                                Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div
                    className={`fixed bottom-6 right-6 z-50 anim-toast text-sm font-medium px-4 py-3 rounded-xl shadow-lg max-w-xs ${
                        toast.tipo === 'ok' ? 'bg-gray-900 text-white' : 'bg-red-600 text-white'
                    }`}
                >
                    {toast.txt}
                </div>
            )}
        </div>
    );
}
