// ============================================================
// SUNAT XML Signer - Digital Signature for SUNAT CPE
// ============================================================
// Based on @supernova-team/xml-sunat proven implementation.
// Uses xml-crypto + node-forge for proper XMLDSig compatible
// with SUNAT's electronic invoicing system.
// ============================================================

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { SunatConfig } from "./config-transavic";

interface CertificateData {
  privateKey: string;
  certificate: string;
  certBase64: string; // Certificate content without PEM headers, for X509Data
}

/**
 * Extrae la clave privada y el certificado de un archivo .pfx/.p12
 * usando node-forge para soporte completo de PKCS12.
 * 
 * Soporta dos modos de carga:
 * 1. SUNAT_CERTIFICATE_BASE64 (env var) — para Vercel/producción
 * 2. Archivo .p12 (file path) — para desarrollo local
 */
function extractCertificate(config: SunatConfig): CertificateData {
  let pfxBuffer: Buffer;

  // Prioridad 1: Certificado como Base64 en config (viene del env var con prefijo de empresa)
  const pfxCertBase64 = config.certificateBase64;
  if (pfxCertBase64) {
    pfxBuffer = Buffer.from(pfxCertBase64, "base64");
  } else {
    // Prioridad 2: Archivo .p12 local (desarrollo)
    const certPath = path.resolve(config.certificatePath);
    if (!fs.existsSync(certPath)) {
      throw new Error(
        `Certificado no encontrado para ${config.empresa || "empresa"}. Configure la variable de entorno correspondiente o verifique la ruta: ${certPath}`
      );
    }
    pfxBuffer = fs.readFileSync(certPath);
  }

  // Convertir Buffer a binary string para node-forge
  const pfxDer = forge.util.createBuffer(pfxBuffer.toString("binary"));
  const pfxAsn1 = forge.asn1.fromDer(pfxDer);
  const p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, config.certificatePassword);

  // Extraer clave privada
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];

  if (!keyBag?.key) {
    throw new Error("No se encontró la clave privada en el archivo PFX");
  }

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);

  // Extraer certificado
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];

  if (!certBag?.cert) {
    throw new Error("No se encontró el certificado en el archivo PFX");
  }

  const certPem = forge.pki.certificateToPem(certBag.cert);

  // Extract base64 certificate content (without PEM headers)
  const certBase64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/(\r\n|\n|\r)/gm, "")
    .trim();

  return {
    privateKey: privateKeyPem,
    certificate: certPem,
    certBase64,
  };
}

/**
 * Firma un documento XML para SUNAT.
 * 
 * Implementación basada en @supernova-team/xml-sunat que es compatible
 * con la validación de firma de SUNAT:
 * - Algoritmo de firma: RSA-SHA1
 * - Algoritmo de digest: SHA256
 * - Canonicalización: C14N
 * - Transforms: enveloped-signature + C14N
 * - Ubicación de firma: dentro de ext:ExtensionContent
 */
export function firmarXML(xmlSinFirma: string, config: SunatConfig): {
  xmlFirmado: string;
  hashCpe: string;
} {
  // Solo saltar la firma si NO hay certificado en NINGUNA forma (ni base64 ni archivo).
  // BUG HISTÓRICO: antes la condición era `beta && !certificatePath`, pero como
  // siempre usamos `certificateBase64` (no path), saltaba la firma SIEMPRE en beta
  // → SUNAT rechazaba con 2335 "No signature in message". Si hay certificado,
  // SIEMPRE firmamos, sea beta o producción.
  if (!config.certificateBase64 && !config.certificatePath) {
    const hashCpe = crypto
      .createHash("sha256")
      .update(xmlSinFirma)
      .digest("base64");
    return { xmlFirmado: xmlSinFirma, hashCpe };
  }

  const { privateKey, certificate, certBase64 } = extractCertificate(config);

  // Configurar xml-crypto SignedXml (misma configuración que @supernova-team/xml-sunat)
  const sig = new SignedXml({
    privateKey: privateKey,
    publicCert: certificate,
    // RSA-SHA1 para firma (requerido por SUNAT)
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    // C14N para canonicalización
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    // KeyInfo personalizado con X509Data
    getKeyInfoContent: () => {
      return `<ds:X509Data><ds:X509Certificate>${certBase64}</ds:X509Certificate></ds:X509Data>`;
    },
  });

  // Detectar el tipo de documento raíz del XML para el XPath correcto
  // Invoice (01/03), CreditNote (07), DebitNote (08), VoidedDocuments, SummaryDocuments
  const rootElements = ["CreditNote", "DebitNote", "VoidedDocuments", "SummaryDocuments", "Invoice", "DespatchAdvice"];
  let rootElementName = "Invoice"; // default
  for (const el of rootElements) {
    if (xmlSinFirma.includes(`<${el}`) || xmlSinFirma.includes(`:${el}`)) {
      rootElementName = el;
      break;
    }
  }

  // Referencia al documento con transforms enveloped-signature + C14N
  sig.addReference({
    xpath: `//*[local-name()='${rootElementName}']`,
    // xml-crypto necesita el transform C14N explícito tras enveloped para que el
    // digest coincida con el que recalcula SUNAT. Sin él → 2335 "Incorrect reference
    // digest value". Con él, la firma valida y SUNAT pasa a validar el esquema.
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    isEmptyUri: true,
  });

  // Computar firma e insertar en ExtensionContent
  sig.computeSignature(xmlSinFirma, {
    prefix: "ds",
    attrs: { Id: "SignatureSP" },
    location: {
      reference: "//*[local-name(.)='ExtensionContent']",
      action: "prepend",
    },
  });

  const xmlFirmado = sig.getSignedXml();

  // Hash del CPE para representación impresa
  const hashCpe = crypto
    .createHash("sha256")
    .update(xmlFirmado)
    .digest("base64");

  return { xmlFirmado, hashCpe };
}
