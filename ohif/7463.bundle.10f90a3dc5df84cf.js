"use strict";
(globalThis["rspackChunk"] = globalThis["rspackChunk"] || []).push([[7463], {
55738(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": () => (/* binding */ viewports_OHIFCornerstonePdfViewport)
});

// EXTERNAL MODULE: ../../../node_modules/react/index.js
var react = __webpack_require__(86326);
// EXTERNAL MODULE: ../../../node_modules/prop-types/index.js
var prop_types = __webpack_require__(97598);
var prop_types_default = /*#__PURE__*/__webpack_require__.n(prop_types);
// EXTERNAL MODULE: ../../../node_modules/react-i18next/dist/es/index.js + 15 modules
var es = __webpack_require__(68852);
// EXTERNAL MODULE: ../../core/src/index.ts + 75 modules
var src = __webpack_require__(50679);
;// CONCATENATED MODULE: ../../../extensions/dicom-pdf/src/viewports/OHIFCornerstonePdfViewport.css
// extracted by css-extract-rspack-plugin

;// CONCATENATED MODULE: ../../../extensions/dicom-pdf/src/viewports/OHIFCornerstonePdfViewport.tsx






/** Translation keys in the EncapsulatedDocument namespace, by failure reason. */
const FAILURE_MESSAGE_KEYS = {
  'unsupported-type': 'This document type cannot be displayed',
  'signature-mismatch': 'Document content does not match its declared type',
  'retrieve-failed': 'Unable to retrieve this document',
  aborted: 'Loading document...'
};
function OHIFCornerstonePdfViewport({
  displaySets,
  viewportId = 'pdf-viewport'
}) {
  const [embeddedDocument, setEmbeddedDocument] = (0,react.useState)(null);
  const [failure, setFailure] = (0,react.useState)(null);
  const viewportElementRef = (0,react.useRef)(null);
  const viewportRef = (0,src/* .useViewportRef */.bs)(viewportId);
  const {
    t
  } = (0,es/* .useTranslation */.Bd)('EncapsulatedDocument');
  (0,react.useEffect)(() => {
    document.body.addEventListener('drag', makePdfDropTarget);
    return function cleanup() {
      document.body.removeEventListener('drag', makePdfDropTarget);
      viewportRef.unregister();
    };
  }, []);
  const [style, setStyle] = (0,react.useState)('pdf-yes-click');
  const makePdfScrollable = () => {
    setStyle('pdf-yes-click');
  };
  const makePdfDropTarget = () => {
    setStyle('pdf-no-click');
  };
  if (displaySets && displaySets.length > 1) {
    throw new Error('OHIFCornerstonePdfViewport: only one display set is supported for dicom pdf right now');
  }
  const {
    getDocument,
    label
  } = displaySets[0];
  (0,react.useEffect)(() => {
    let isCancelled = false;
    let revokeUrl;
    const abortController = new AbortController();
    const load = async () => {
      const result = await getDocument({
        signal: abortController.signal
      });
      if (isCancelled) {
        if (result.ok) {
          result.revoke();
        }
        return;
      }
      if (!result.ok) {
        setEmbeddedDocument(null);
        setFailure(result.reason);
        return;
      }
      revokeUrl = result.revoke;
      setEmbeddedDocument({
        url: result.url,
        documentType: result.documentType
      });
      setFailure(null);
    };
    setEmbeddedDocument(null);
    setFailure(null);
    load();
    return () => {
      isCancelled = true;
      abortController.abort();
      revokeUrl?.();
    };
  }, [getDocument]);
  return /*#__PURE__*/react.createElement("div", {
    className: "bg-primary-black text-foreground h-full w-full",
    onClick: makePdfScrollable,
    ref: el => {
      viewportElementRef.current = el;
      if (el) {
        viewportRef.register(el);
      }
    },
    "data-viewport-id": viewportId
  }, embeddedDocument ? renderDocument(embeddedDocument, style, t, label) : /*#__PURE__*/react.createElement("div", {
    className: "flex h-full w-full items-center justify-center"
  }, t(failure ? FAILURE_MESSAGE_KEYS[failure] : 'Loading document...')));
}
function renderDocument({
  url,
  documentType
}, style, t, label) {
  // <object> is used only for the types the allowlist marks as un-sandboxable -
  // in practice PDF, whose built-in browser viewer will not run in a sandboxed
  // browsing context. The type attribute now matches the Blob type exactly,
  // because loadDisplayableDocument set both from the same allowlist entry.
  if (documentType.strategy === 'object') {
    return /*#__PURE__*/react.createElement("object", {
      data: url,
      type: documentType.mimeType,
      className: style
    }, /*#__PURE__*/react.createElement("div", null, t('No viewer installed for {{mimeType}}', {
      mimeType: documentType.mimeType
    })));
  }
  return /*#__PURE__*/react.createElement("iframe", {
    src: url,
    title: label || t('Encapsulated document'),
    className: `${style} border-0`,
    sandbox: documentType.sandbox ?? '',
    referrerPolicy: "no-referrer",
    allow: ""
  });
}
OHIFCornerstonePdfViewport.propTypes = {
  displaySets: prop_types_default().arrayOf((prop_types_default()).object).isRequired,
  viewportId: (prop_types_default()).string
};
/* export default */ const viewports_OHIFCornerstonePdfViewport = (OHIFCornerstonePdfViewport);

},

}]);