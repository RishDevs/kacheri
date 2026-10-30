import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { createApi } from './api';
import { createDemoCourtSource, createLiveCourtSource } from './court/source';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

const court = __KACHERI_DEMO__
  ? createDemoCourtSource({ assetBase: __KACHERI_BASE__, files: __KACHERI_DEMO_CASES__ })
  : createLiveCourtSource({ assetBase: __KACHERI_BASE__ });

createRoot(root).render(
  <StrictMode>
    <Root api={__KACHERI_DEMO__ ? null : createApi()} court={court} />
  </StrictMode>,
);
