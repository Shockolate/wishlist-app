/**
 * A manage token minted in the browser (D42): 16 random bytes, base64url without padding, 22
 * characters, the same shape the API mints. The sheet saves it before sending the claim, so a
 * lost answer can be found again. `random` is for tests.
 */
export function mintManageToken(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = random(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
