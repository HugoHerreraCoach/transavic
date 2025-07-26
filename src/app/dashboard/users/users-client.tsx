// src/app/dashboard/users/users-client.tsx

'use client';

import { useState } from 'react';
import { User } from '@/lib/types';
import { FiPlus, FiEdit, FiTrash2 } from 'react-icons/fi';
import UserModal from './user-modal';

interface UsersClientPageProps {
    initialUsers: User[];
}

export default function UsersClientPage({ initialUsers }: UsersClientPageProps) {
    const [users, setUsers] = useState<User[]>(initialUsers);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [userToEdit, setUserToEdit] = useState<User | null>(null);

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
                const errorData = await response.json();
                throw new Error(errorData.error || 'No se pudo guardar el usuario.');
            }

            const savedUser = await response.json();

            if (isEditing) {
                setUsers(users.map(u => u.id === savedUser.id ? savedUser : u));
            } else {
                setUsers([...users, savedUser]);
            }
            handleCloseModal();
        } catch (error) {
            alert(`Error: ${error instanceof Error ? error.message : 'Ocurrió un problema'}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteUser = async (userId: string) => {
        if (!confirm('¿Estás seguro de que quieres eliminar este usuario? Esta acción no se puede deshacer.')) {
            return;
        }
        setLoading(true);
        try {
            const response = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
            if (!response.ok) {
                throw new Error('No se pudo eliminar el usuario.');
            }
            setUsers(users.filter(u => u.id !== userId));
        } catch (error) {
            alert(`Error: ${error instanceof Error ? error.message : 'Ocurrió un problema'}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Lista de Usuarios</h2>
                <button
                    onClick={handleOpenCreateModal}
                    className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 flex items-center gap-2 cursor-pointer"
                >
                    <FiPlus />
                    Crear Usuario
                </button>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rol</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {users.map((user) => (
                            <tr key={user.id}>
                                <td className="px-6 py-4 whitespace-nowrap">{user.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap">{user.role}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button onClick={() => handleOpenEditModal(user)} className="text-indigo-600 hover:text-indigo-900 mr-4 cursor-pointer"><FiEdit /></button>
                                    <button onClick={() => handleDeleteUser(user.id)} className="text-red-600 hover:text-red-900 cursor-pointer"><FiTrash2 /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <UserModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSave={handleSaveUser}
                userToEdit={userToEdit}
                isLoading={loading}
            />
        </div>
    );
}