export const SUPPORT_EMAIL = 'samerodeh.dev@gmail.com';
export const PRIVACY_URL = 'https://localgo.vercel.app/privacy';
export const DELETION_URL = 'https://localgo.vercel.app/delete-account';

export function deletionRequestUrl(email: string | undefined): string {
  const subject = 'Delete my LocalGo account';
  const body = [
    'Please delete my LocalGo consumer account and its associated personal data.',
    `Account email: ${email ?? '(enter your registered email)'}`,
    '',
    'Please confirm receipt and let me know if any records must be retained and why.',
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
