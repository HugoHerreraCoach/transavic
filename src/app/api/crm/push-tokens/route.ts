import { neon } from '@neondatabase/serverless';
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { token, deviceType } = await req.json();
    if (!token) {
      return NextResponse.json({ error: 'Token es requerido' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    
    // Insertar token y actualizar en conflicto (UPSERT)
    await sql`
      INSERT INTO user_fcm_tokens (usuario_id, token, device_type, last_used_at)
      VALUES (${session.user.id}, ${token}, ${deviceType || 'web'}, NOW())
      ON CONFLICT (token) 
      DO UPDATE SET 
        usuario_id = ${session.user.id}, 
        device_type = ${deviceType || 'web'},
        last_used_at = NOW();
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('❌ [POST] Error guardando token FCM:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { token } = await req.json();
    if (!token) {
      return NextResponse.json({ error: 'Token es requerido' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    await sql`
      DELETE FROM user_fcm_tokens
      WHERE token = ${token};
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('❌ [DELETE] Error eliminando token FCM:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
