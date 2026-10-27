// Authentication screens in fixture mode (VITE_USE_MOCK=true, Vitest only). API calls that matter
// for a scenario are spied on so the screens' handling of real server responses is exercised.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../context/AuthContext'
import { authApi } from '../services/api'
import { ApiError } from '../services/http'

const MOCK = String(import.meta.env.VITE_USE_MOCK) === 'true'
const open = (path, role) => {
  if (role) localStorage.setItem('yoloa_role', role)
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
}
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe.skipIf(!MOCK)('login type selection', () => {
  it('is the first screen and offers separate student and administrator portals', async () => {
    open('/')
    expect(await screen.findByRole('heading', { name: /how would you like to sign in/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue as Student' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Continue as Administrator' })).toHaveAttribute('href', '/admin/login')
  })

  it('navigates to each sign-in page and back with the keyboard', async () => {
    const user = userEvent.setup()
    open('/')
    await screen.findByRole('link', { name: 'Continue as Student' })
    await user.tab() // logo link
    await user.tab()
    expect(screen.getByRole('link', { name: 'Continue as Student' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'Student sign in' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /choose a different sign-in type/i }))
    await user.click(await screen.findByRole('link', { name: 'Continue as Administrator' }))
    expect(await screen.findByRole('heading', { name: 'Administrator sign in' })).toBeInTheDocument()
  })

  it('sends a signed-in user straight to their own dashboard', async () => {
    open('/', 'admin')
    expect(await screen.findByTestId('students-registered')).toBeInTheDocument()
  })
})

describe.skipIf(!MOCK)('authentication boundaries', () => {
  it('does not automatically authenticate a predefined user', async () => {
    open('/student/dashboard')
    expect(await screen.findByRole('heading', { name: 'Student sign in' })).toBeInTheDocument()
    expect(screen.queryByText('Test Learner')).not.toBeInTheDocument()
  })

  it('sends anonymous visitors to administrator pages to the administrator sign-in', async () => {
    open('/admin/students')
    expect(await screen.findByRole('heading', { name: 'Administrator sign in' })).toBeInTheDocument()
  })

  it('keeps a signed-in student out of administrator pages', async () => {
    open('/admin/dashboard', 'student')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByTestId('students-registered')).not.toBeInTheDocument()
  })

  it('administrator sign-in has no Google or student registration options', async () => {
    open('/admin/login')
    expect(await screen.findByRole('heading', { name: 'Administrator sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /create an account/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password?portal=admin')
    expect(screen.getByRole('link', { name: /choose a different sign-in type/i })).toHaveAttribute('href', '/')
  })

  it('redirects the legacy /login?role=admin link to the administrator page', async () => {
    open('/login?role=admin')
    expect(await screen.findByRole('heading', { name: 'Administrator sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
  })

  it('student sign-in offers Google, registration and password recovery', async () => {
    open('/login')
    await waitFor(() => expect(screen.getByRole('button', { name: /continue with google/i })).toBeEnabled())
    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password')
  })

  it('explains when Google sign-in is not configured instead of failing later', async () => {
    vi.spyOn(authApi, 'googleStatus').mockResolvedValue({ configured: false })
    open('/login')
    expect(await screen.findByText(/google sign-in is not configured on the server yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled()
  })

  it('shows the OAuth callback error returned by the server', async () => {
    open('/login?auth_error=google_account_link_required')
    expect(await screen.findByRole('alert')).toHaveTextContent(/already has a YOLOA account/i)
  })
})

describe.skipIf(!MOCK)('signing in', () => {
  it('validates the form before calling the server', async () => {
    const login = vi.spyOn(authApi, 'login')
    const user = userEvent.setup()
    open('/login')
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()
  })

  it('logs in a student with email and password and can reveal the password', async () => {
    const login = vi.spyOn(authApi, 'login')
    const user = userEvent.setup()
    open('/login')
    await user.type(await screen.findByLabelText('Email address'), 'learner@example.test')
    const password = screen.getByLabelText('Password')
    await user.type(password, 'student123')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(login).toHaveBeenCalledWith({ email: 'learner@example.test', password: 'student123', role: 'student' })
  })

  it('shows the server refusal when a student uses the administrator portal and stays signed out', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new ApiError('This account does not have administrator access.', 403))
    const user = userEvent.setup()
    open('/admin/login')
    await user.type(await screen.findByLabelText('Email address'), 'learner@example.test')
    await user.type(screen.getByLabelText('Password'), 'student123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This account does not have administrator access.')
    expect(screen.getByRole('heading', { name: 'Administrator sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('signs in an administrator to the admin dashboard', async () => {
    const user = userEvent.setup()
    open('/admin/login')
    await user.type(await screen.findByLabelText('Email address'), 'admin@example.com')
    await user.type(screen.getByLabelText('Password'), 'admin-pass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByTestId('students-registered')).toBeInTheDocument()
  })

  it('disables the form while the request is in progress', async () => {
    let finish
    vi.spyOn(authApi, 'login').mockImplementation(() => new Promise((resolve, reject) => { finish = reject }))
    const user = userEvent.setup()
    open('/login')
    await user.type(await screen.findByLabelText('Email address'), 'learner@example.test')
    await user.type(screen.getByLabelText('Password'), 'student123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('button', { name: /signing in/i })).toBeDisabled()
    finish(new ApiError('Invalid email or password.', 401))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.')
  })

  it('logs out back to the login type selection', async () => {
    const logout = vi.spyOn(authApi, 'logout')
    const user = userEvent.setup()
    open('/student/dashboard', 'student')
    await user.click(await screen.findByRole('button', { name: /open menu/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /log out/i }))
    expect(await screen.findByRole('heading', { name: /how would you like to sign in/i })).toBeInTheDocument()
    expect(logout).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('yoloa_role')).toBeNull()
  })
})

describe.skipIf(!MOCK)('student registration', () => {
  const fill = async (user, values) => {
    await user.type(await screen.findByLabelText('Full name'), values.fullName)
    await user.type(screen.getByLabelText('Email address'), values.email)
    await user.type(screen.getByLabelText('Password'), values.password)
    await user.type(screen.getByLabelText('Confirm password'), values.confirmation)
  }

  it('rejects mismatched passwords without calling the server', async () => {
    const register = vi.spyOn(authApi, 'register')
    const user = userEvent.setup()
    open('/register')
    await fill(user, { fullName: 'New Learner', email: 'learner@example.com', password: 'Strong-pass-92!', confirmation: 'Different-92!' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  it('creates the account and shows the new student, not a predefined one', async () => {
    const register = vi.spyOn(authApi, 'register')
    const user = userEvent.setup()
    open('/register')
    await fill(user, { fullName: 'New Learner', email: 'learner@example.com', password: 'Strong-pass-92!', confirmation: 'Strong-pass-92!' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect((await screen.findAllByText('New Learner')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Test Learner')).not.toBeInTheDocument()
    // Only the four registration fields are ever submitted — never a role or staff flag.
    expect(register).toHaveBeenCalledWith({ fullName: 'New Learner', email: 'learner@example.com', password: 'Strong-pass-92!', passwordConfirmation: 'Strong-pass-92!' })
  })

  it('reports a duplicate email with links to sign in or reset', async () => {
    vi.spyOn(authApi, 'register').mockRejectedValue(new ApiError('An account with this email already exists.', 409))
    const user = userEvent.setup()
    open('/register')
    await fill(user, { fullName: 'Ada', email: 'ada@example.com', password: 'Strong-pass-92!', confirmation: 'Strong-pass-92!' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('link', { name: 'reset your password' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByRole('heading', { name: 'Create your student account' })).toBeInTheDocument()
  })

  it('shows server password rules next to the password field', async () => {
    vi.spyOn(authApi, 'register').mockRejectedValue(new ApiError('Please choose a stronger password.', 400, { errors: { password: ['This password is too common.'] } }))
    const user = userEvent.setup()
    open('/register')
    await fill(user, { fullName: 'Ada', email: 'ada2@example.com', password: 'password1', confirmation: 'password1' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('This password is too common.')).toBeInTheDocument()
  })
})

describe.skipIf(!MOCK)('password recovery', () => {
  it('shows the generic confirmation from the server', async () => {
    const request = vi.spyOn(authApi, 'requestPasswordReset')
    const user = userEvent.setup()
    open('/forgot-password?portal=admin')
    expect(await screen.findByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/admin/login')
    await user.type(screen.getByLabelText('Email address'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/if an account exists for that email/i)
    expect(request).toHaveBeenCalledWith('someone@example.com')
  })

  it('reports when the server cannot send reset email', async () => {
    vi.spyOn(authApi, 'requestPasswordReset').mockRejectedValue(new ApiError('Password reset email is not available right now. Please contact your administrator.', 503))
    const user = userEvent.setup()
    open('/forgot-password')
    await user.type(await screen.findByLabelText('Email address'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not available right now/i)
  })

  it('rejects an incomplete reset link without showing the form', async () => {
    open('/reset-password')
    expect(await screen.findByRole('alert')).toHaveTextContent(/incomplete/i)
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })

  it('rejects an expired or used link reported by the server', async () => {
    vi.spyOn(authApi, 'validateResetLink').mockRejectedValue(new ApiError('This password reset link is invalid, has expired, or has already been used.', 400))
    open('/reset-password?uid=MQ&token=used-token')
    expect(await screen.findByRole('alert')).toHaveTextContent(/already been used/i)
    expect(screen.getByRole('link', { name: /request a new link/i })).toBeInTheDocument()
  })

  it('updates the password with a valid link', async () => {
    const validate = vi.spyOn(authApi, 'validateResetLink')
    const reset = vi.spyOn(authApi, 'resetPassword')
    const user = userEvent.setup()
    open('/reset-password?uid=MQ&token=good-token')
    await user.type(await screen.findByLabelText('New password'), 'New-portal-pass-93!')
    await user.type(screen.getByLabelText('Confirm new password'), 'New-portal-pass-93!')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeInTheDocument()
    expect(validate).toHaveBeenCalledWith({ uid: 'MQ', token: 'good-token' })
    expect(reset).toHaveBeenCalledWith({ uid: 'MQ', token: 'good-token', password: 'New-portal-pass-93!', passwordConfirmation: 'New-portal-pass-93!' })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Return to sign in' })).toHaveAttribute('href', '/'))
  })
})
