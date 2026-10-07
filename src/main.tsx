import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { SiteStatusProvider } from './auth/SiteStatusContext';
import './fonts.css';
import './design-tokens.css';
import './styles.css';

const router = createBrowserRouter([{ path: '*', element: <App /> }]);
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthProvider><SiteStatusProvider><RouterProvider router={router} /></SiteStatusProvider></AuthProvider></React.StrictMode>);
