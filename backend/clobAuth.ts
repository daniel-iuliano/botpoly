
/**
 * CLOB Authentication Service
 * Implements off-chain HMAC signing for API requests.
 */

export interface AuthHeaders {
  'POLY-API-KEY': string;
  'POLY-API-SIGN': string;
  'POLY-API-TIMESTAMP': string;
  'POLY-API-PASSPHRASE': string;
  'Content-Type': string;
}

export async function getAuthHeaders(method: string, path: string, body: string = ''): Promise<AuthHeaders> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = process.env.API_KEY || ''; 
  const apiKey = "BOT_CLOB_KEY"; 
  const passphrase = "BOT_CLOB_PASSPHRASE"; 

  const message = timestamp + method.toUpperCase() + path + body;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const signatureArray = new Uint8Array(signatureBuffer);
  
  // Robust base64 conversion for browser environment
  let binary = '';
  for (let i = 0; i < signatureArray.byteLength; i++) {
    binary += String.fromCharCode(signatureArray[i]);
  }
  const signatureBase64 = btoa(binary);

  return {
    'POLY-API-KEY': apiKey,
    'POLY-API-SIGN': signatureBase64,
    'POLY-API-TIMESTAMP': timestamp,
    'POLY-API-PASSPHRASE': passphrase,
    'Content-Type': 'application/json'
  };
}
