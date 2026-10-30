import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';
import { CatalogProvider } from './catalog.jsx';
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><CatalogProvider><App/></CatalogProvider></BrowserRouter></React.StrictMode>);
