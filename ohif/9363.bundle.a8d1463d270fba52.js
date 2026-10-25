"use strict";
(globalThis["rspackChunk"] = globalThis["rspackChunk"] || []).push([[9363], {
42446(__unused_rspack_module, __webpack_exports__, __webpack_require__) {

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": () => (/* binding */ dicom_pdf_src)
});

// EXTERNAL MODULE: ../../../node_modules/react/index.js
var react = __webpack_require__(86326);
;// CONCATENATED MODULE: ../../../extensions/dicom-pdf/package.json
var package_namespaceObject = JSON.parse('{"UU":"@ohif/extension-dicom-pdf"}')
;// CONCATENATED MODULE: ../../../extensions/dicom-pdf/src/id.js

const id = package_namespaceObject.UU;
const SOPClassHandlerId = `${id}.sopClassHandlerModule.dicom-pdf`;

// EXTERNAL MODULE: ../../core/src/index.ts + 75 modules
var src = __webpack_require__(50679);
// EXTERNAL MODULE: ../../i18n/src/index.js + 291 modules
var i18n_src = __webpack_require__(22299);
;// CONCATENATED MODULE: ../../../extensions/dicom-pdf/src/utils/displayableDocumentTypes.ts
/**
 * The set of encapsulated-document MIME types this extension is willing to put
 * in front of a user, and how each one is embedded.
 *
 * MIMETypeOfEncapsulatedDocument is supplied by whoever produced the instance,
 * so it is treated here as a claim to be checked rather than an instruction to
 * be followed. A type that is not on this list is not rendered at all.
 */

/**
 * How a document is embedded in the viewport.
 *
 * 'object' - <object>. The browsers' built-in PDF viewers refuse to run inside
 *   a sandboxed browsing context: in Chrome a PDF renders under no sandbox at
 *   all and under none of the token combinations, including the fully
 *   permissive `allow-scripts allow-same-origin`. PDFs therefore cannot be
 *   sandboxed, and their safety rests entirely on the type guarantee that
 *   loadDisplayableDocument applies (canonical Blob type + signature check).
 *
 * 'iframe' - <iframe sandbox>. Markup types render correctly inside a sandbox,
 *   so they get one. The default is the empty sandbox: no tokens, scripts
 *   inert, opaque origin, no access to the viewer's storage or DOM.
 */

/**
 * Real files do not always put their magic number at byte 0, and readers that
 * accept them anyway are the reason such files exist in the wild.
 *
 * PDF: ISO 32000-1 requires "%PDF-" at the start of the file, but Adobe's own
 * implementation note relaxes this to anywhere within the first 1024 bytes, and
 * every mainstream reader follows suit. Producers that write a UTF-8 BOM, or
 * that prepend junk before the header, therefore produce files that open
 * everywhere except here. Matching the 1024-byte allowance keeps the check
 * doing its actual job - catching a payload that is not a PDF at all, which is
 * how a document declared as PDF but containing markup gets rejected - without
 * failing valid documents over leading bytes the renderer will skip anyway.
 */
const PDF_SIGNATURE_SEARCH_LIMIT = 1024;

/**
 * Canonical entries, keyed by canonical MIME type. Exported so downstream
 * deployments can extend the list; adding an entry means asserting both that
 * the browser renders that type inline and that the chosen strategy contains it.
 */
const DISPLAYABLE_DOCUMENT_TYPES = {
  'application/pdf': {
    mimeType: 'application/pdf',
    strategy: 'object',
    signature: [0x25, 0x50, 0x44, 0x46, 0x2d],
    // "%PDF-"
    signatureSearchLimit: PDF_SIGNATURE_SEARCH_LIMIT
  },
  'text/html': {
    mimeType: 'text/html',
    strategy: 'iframe',
    sandbox: ''
  },
  'application/xhtml+xml': {
    mimeType: 'application/xhtml+xml',
    strategy: 'iframe',
    sandbox: ''
  },
  'text/xml': {
    mimeType: 'text/xml',
    strategy: 'iframe',
    sandbox: ''
  },
  'application/xml': {
    mimeType: 'application/xml',
    strategy: 'iframe',
    sandbox: ''
  },
  'text/plain': {
    mimeType: 'text/plain',
    strategy: 'iframe',
    sandbox: ''
  }
};

/**
 * Non-standard spellings seen in real instances, folded onto their canonical
 * entry. Accepting an alias is safe because the canonical entry decides both
 * the Blob type and the signature the payload has to satisfy.
 */
const DOCUMENT_MIME_TYPE_ALIASES = {
  'application/html': 'text/html',
  'application/x-pdf': 'application/pdf',
  'application/acrobat': 'application/pdf',
  'text/pdf': 'application/pdf',
  'application/xhtml': 'application/xhtml+xml'
};

/**
 * Lower-cases and strips any parameters (`text/html; charset=utf-8`).
 */
function normalizeDocumentMimeType(rawMimeType) {
  if (typeof rawMimeType !== 'string') {
    return undefined;
  }
  const normalized = rawMimeType.split(';')[0].trim().toLowerCase();
  return normalized || undefined;
}

/**
 * Resolves a declared MIME type to its allowlist entry, or undefined when the
 * type is not one this extension will display.
 */
function getDisplayableDocumentType(rawMimeType) {
  const normalized = normalizeDocumentMimeType(rawMimeType);
  if (!normalized) {
    return undefined;
  }
  const canonical = DOCUMENT_MIME_TYPE_ALIASES[normalized] ?? normalized;
  return DISPLAYABLE_DOCUMENT_TYPES[canonical];
}

/**
 * Checks a payload against its type's magic number, allowing the signature to
 * start anywhere within `signatureSearchLimit` bytes of the payload. Types that
 * have no reliable signature pass, since for those the sandbox rather than the
 * content check is what contains the document.
 */
function matchesDocumentSignature(documentType, payload) {
  const {
    signature,
    signatureSearchLimit = 0
  } = documentType;
  if (!signature?.length) {
    return true;
  }
  if (payload.byteLength < signature.length) {
    return false;
  }

  // Only the window the signature could still start in needs reading, and it is
  // bounded, so an oversized document costs the same as a small one.
  const lastStart = Math.min(signatureSearchLimit, payload.byteLength - signature.length);
  const head = new Uint8Array(payload, 0, lastStart + signature.length);
  for (let start = 0; start <= lastStart; start++) {
    if (signature.every((byte, index) => head[start + index] === byte)) {
      return true;
    }
  }
  return false;
}
;// CONCATENATED MODULE: ../../../extensions/dicom-pdf/src/utils/loadDisplayableDocument.ts

/**
 * Resolves an encapsulated document into something safe to embed.
 *
 * The payload comes from the instance the same way every other bulkdata value
 * does: inline content when the metadata carries it, otherwise the data
 * source's own `retrieveBulkData`, which the data source binds onto the value
 * and which caches the resolved buffer on `value.Value`. This is the path the
 * video display sets take, so authentication, bulkdata URI resolution and
 * caching all behave identically here.
 *
 * The bytes are then wrapped in a Blob whose type comes from the allowlist
 * rather than from the instance. That is the type guarantee: after this point
 * neither MIMETypeOfEncapsulatedDocument nor the origin server's Content-Type
 * has any say in how the browser interprets the payload, so a document cannot
 * be steered into being parsed as something it is not.
 */
async function loadDisplayableDocument({
  instance,
  mimeType,
  tag = 'EncapsulatedDocument'
}, {
  signal
} = {}) {
  const documentType = getDisplayableDocumentType(mimeType);
  if (!documentType) {
    return {
      ok: false,
      reason: 'unsupported-type',
      mimeType
    };
  }
  const value = instance?.[tag];
  if (!value) {
    return {
      ok: false,
      reason: 'retrieve-failed'
    };
  }
  if (signal?.aborted) {
    return {
      ok: false,
      reason: 'aborted'
    };
  }
  let payload;
  try {
    payload = await readDocumentBytes(value, documentType.mimeType);
  } catch (error) {
    console.warn('Failed to retrieve encapsulated document', error);
    return {
      ok: false,
      reason: 'retrieve-failed'
    };
  }
  if (!payload?.byteLength) {
    return {
      ok: false,
      reason: 'retrieve-failed'
    };
  }
  if (signal?.aborted) {
    return {
      ok: false,
      reason: 'aborted'
    };
  }
  if (!matchesDocumentSignature(documentType, payload)) {
    return {
      ok: false,
      reason: 'signature-mismatch',
      mimeType: documentType.mimeType
    };
  }
  const objectUrl = URL.createObjectURL(new Blob([payload], {
    type: documentType.mimeType
  }));
  if (signal?.aborted) {
    URL.revokeObjectURL(objectUrl);
    return {
      ok: false,
      reason: 'aborted'
    };
  }
  return {
    ok: true,
    url: objectUrl,
    documentType,
    revoke: createRevokeOnce(objectUrl)
  };
}

/**
 * Reads the document bytes off a naturalized bulkdata value, preferring
 * whatever is already in hand. Mirrors the resolution order in
 * `resolveBulkDataTags`, which is how the rest of the app reads bulkdata.
 */
async function readDocumentBytes(value, mimeType) {
  // Inline content delivered as base64 in the metadata.
  if (value.InlineBinary) {
    return base64ToArrayBuffer(value.InlineBinary);
  }

  // Inline content that the parser already decoded, e.g. `[ArrayBuffer]`.
  if (Array.isArray(value)) {
    return toArrayBuffer(value[0]);
  }

  // retrieveBulkData caches the resolved buffer here, so prefer it over
  // re-requesting the payload.
  if (value.Value) {
    return toArrayBuffer(Array.isArray(value.Value) ? value.Value[0] : value.Value);
  }

  // Otherwise ask the data source, exactly as any other bulkdata value does.
  if (typeof value.retrieveBulkData === 'function') {
    const retrieved = await value.retrieveBulkData({
      mediaType: mimeType
    });
    return toArrayBuffer(retrieved);
  }
  return undefined;
}
function toArrayBuffer(raw) {
  // Check views first: ArrayBuffer.isView is realm-agnostic.
  if (ArrayBuffer.isView(raw)) {
    const view = raw;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  // `instanceof ArrayBuffer` is realm-specific, so fall back to a tag check so
  // that buffers created in another realm (workers, tests) are still handled.
  if (raw instanceof ArrayBuffer || Object.prototype.toString.call(raw) === '[object ArrayBuffer]') {
    return raw;
  }
  return undefined;
}

/**
 * Decodes base64 inline content to bytes. `utils.b64toBlob` produces a Blob,
 * but the signature check needs the bytes before a Blob is created - and the
 * Blob has to be built from the allowlist type, not from a declared one.
 */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
function createRevokeOnce(objectUrl) {
  let revoked = false;
  return () => {
    if (revoked) {
      return;
    }
    URL.revokeObjectURL(objectUrl);
    revoked = true;
  };
}
;// CONCATENATED MODULE: ../../../extensions/dicom-pdf/src/getSopClassHandlerModule.js





const SOP_CLASS_UIDS = {
  ENCAPSULATED_PDF: '1.2.840.10008.5.1.4.1.1.104.1'
};
const sopClassUids = Object.values(SOP_CLASS_UIDS);
const _getDisplaySetsFromSeries = (instances, servicesManager, extensionManager) => {
  return instances.map(instance => {
    const {
      Modality,
      SOPInstanceUID
    } = instance;
    const {
      SeriesDescription = 'PDF',
      MIMETypeOfEncapsulatedDocument
    } = instance;
    const {
      SeriesNumber,
      SeriesDate,
      SeriesInstanceUID,
      StudyInstanceUID,
      SOPClassUID
    } = instance;
    // The declared type is only a claim. It is resolved against the displayable
    // type allowlist, and the payload is re-wrapped in a Blob of the canonical
    // type, so the instance cannot steer how the browser parses the document.
    const mimeType = normalizeDocumentMimeType(MIMETypeOfEncapsulatedDocument) || 'application/pdf';
    const documentParams = {
      instance,
      tag: 'EncapsulatedDocument',
      mimeType
    };
    const getDocument = options => loadDisplayableDocument(documentParams, options);
    const displaySet = {
      //plugin: id,
      Modality,
      displaySetInstanceUID: src/* .utils.guid */.Wp.guid(),
      SeriesDescription,
      SeriesNumber,
      SeriesDate,
      SOPInstanceUID,
      SeriesInstanceUID,
      StudyInstanceUID,
      SOPClassHandlerId: SOPClassHandlerId,
      SOPClassUID,
      referencedImages: null,
      measurements: null,
      getDocument,
      mimeType,
      instances: [instance],
      thumbnailSrc: null,
      isDerivedDisplaySet: true,
      isLoaded: false,
      sopClassUids,
      numImageFrames: 0,
      numInstances: 1,
      instance,
      supportsWindowLevel: true,
      label: SeriesDescription || `${i18n_src/* ["default"].t */.A.t('Series')} ${SeriesNumber} - ${i18n_src/* ["default"].t */.A.t(Modality)}`
    };
    return displaySet;
  });
};
function getSopClassHandlerModule(params) {
  const {
    servicesManager,
    extensionManager
  } = params;
  const getDisplaySetsFromSeries = instances => {
    return _getDisplaySetsFromSeries(instances, servicesManager, extensionManager);
  };
  return [{
    name: 'dicom-pdf',
    sopClassUids,
    getDisplaySetsFromSeries
  }];
}
;// CONCATENATED MODULE: ../../../extensions/dicom-pdf/src/index.tsx



const Component = /*#__PURE__*/react.lazy(() => {
  return __webpack_require__.e(/* import() */ 7463).then(__webpack_require__.bind(__webpack_require__, 55738));
});
const OHIFCornerstonePdfViewport = props => {
  return /*#__PURE__*/react.createElement(react.Suspense, {
    fallback: /*#__PURE__*/react.createElement("div", null, "Loading...")
  }, /*#__PURE__*/react.createElement(Component, props));
};

/**
 *
 */
const dicomPDFExtension = {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id: id,
  /**
   *
   *
   * @param {object} [configuration={}]
   * @param {object|array} [configuration.csToolsConfig] - Passed directly to `initCornerstoneTools`
   */
  getViewportModule() {
    const ExtendedOHIFCornerstonePdfViewport = props => {
      return /*#__PURE__*/react.createElement(OHIFCornerstonePdfViewport, props);
    };
    return [{
      name: 'dicom-pdf',
      component: ExtendedOHIFCornerstonePdfViewport
    }];
  },
  getSopClassHandlerModule: getSopClassHandlerModule
};
/* export default */ const dicom_pdf_src = (dicomPDFExtension);

},

}]);