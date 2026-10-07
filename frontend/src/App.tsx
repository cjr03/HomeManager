import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { AuthProvider, RequireAuth } from '@/lib/auth'
import { AccountPage } from '@/pages/AccountPage'
import { BudgetPage } from '@/pages/BudgetPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { LoginPage } from '@/pages/LoginPage'
import { MealsPage } from '@/pages/MealsPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/meals" replace />} />
          <Route path="/meals" element={<MealsPage />} />
          <Route path="/budget" element={<BudgetPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/account" element={<AccountPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
