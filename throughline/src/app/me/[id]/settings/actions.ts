'use server';
/**
 * Account deletion (server action, so it can sign the user out in the same
 * step). Only the athlete themself, or an admin, may delete an account; the
 * typed confirmation guards against a stray click.
 */
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { authConfigured } from '@/auth.config';
import { getDb } from '@/db';
import { deleteAthleteAccount } from '@/server/accountDeletion';

export interface DeleteState {
  error?: string;
}

export async function deleteMyAccount(athleteId: string, _prev: DeleteState, formData: FormData): Promise<DeleteState> {
  if (String(formData.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') {
    return { error: 'Type DELETE to confirm.' };
  }
  const user = authConfigured() ? (await auth())?.user : null;
  const isSelf = !!user && user.athleteId === athleteId;
  const isAdmin = !authConfigured() || user?.role === 'admin';
  if (!isSelf && !isAdmin) return { error: 'You can only delete your own account.' };

  try {
    const db = await getDb();
    await deleteAthleteAccount(db, athleteId);
  } catch (e) {
    console.error('[delete-account]', e instanceof Error ? e.message : e);
    return { error: 'We could not delete your account. Try again, or contact us.' };
  }
  // Your session pointed at the deleted account: end it. (An admin deleting
  // someone else's account just leaves the now-missing page.)
  if (isSelf && authConfigured()) await signOut({ redirectTo: '/?account=deleted' });
  redirect('/?account=deleted');
}
