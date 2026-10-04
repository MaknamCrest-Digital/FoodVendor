import type {ReactNode} from 'react';
import {AuthRequired} from '../../components/auth/AuthProvider';
import {AdminDataProvider} from '../../components/admin/AdminData';
import {PosProvider} from '../../components/pos/PosProvider';
import AdminShell from '../../components/layout/AdminShell';
import {SettingsProvider} from '../../components/settings/SettingsProvider';
export default function AdminLayout({children}:{children:ReactNode}){
  return <AuthRequired><SettingsProvider><AdminDataProvider><PosProvider><AdminShell>{children}</AdminShell></PosProvider></AdminDataProvider></SettingsProvider></AuthRequired>;
}
