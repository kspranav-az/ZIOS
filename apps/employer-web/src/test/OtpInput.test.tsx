import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtpInput } from '@zios/ui';

function boxes(): HTMLInputElement[] {
  return screen.getAllByRole('textbox') as HTMLInputElement[];
}

describe('OtpInput', () => {
  it('renders one box per digit with per-digit labels', () => {
    render(<OtpInput length={6} onComplete={() => {}} autoFocus={false} />);
    const inputs = boxes();
    expect(inputs).toHaveLength(6);
    expect(screen.getByLabelText('Digit 1 of 6')).toBeInTheDocument();
    expect(screen.getByLabelText('Digit 6 of 6')).toBeInTheDocument();
  });

  it('fills digits and auto-advances focus', async () => {
    const user = userEvent.setup();
    render(<OtpInput length={6} onComplete={() => {}} />);
    const inputs = boxes();
    await user.type(inputs[0]!, '1');
    expect(inputs[0]!.value).toBe('1');
    expect(inputs[1]).toHaveFocus();
    await user.type(inputs[1]!, '2');
    expect(inputs[2]).toHaveFocus();
  });

  it('rejects non-numeric characters', async () => {
    const user = userEvent.setup();
    render(<OtpInput length={6} onComplete={() => {}} />);
    const inputs = boxes();
    await user.type(inputs[0]!, 'a');
    expect(inputs[0]!.value).toBe('');
  });

  it('moves back on backspace and clears the previous box', async () => {
    const user = userEvent.setup();
    render(<OtpInput length={6} onComplete={() => {}} />);
    const inputs = boxes();
    await user.type(inputs[0]!, '1');
    await user.type(inputs[1]!, '2');
    // Box 3 focused & empty: backspace moves to box 2 and clears it.
    await user.keyboard('{Backspace}');
    expect(inputs[1]).toHaveFocus();
    expect(inputs[1]!.value).toBe('');
  });

  it('calls onComplete with the full code when the last digit is entered', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<OtpInput length={6} onComplete={onComplete} />);
    await user.keyboard('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('reports the partial code through onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OtpInput length={6} onComplete={() => {}} onChange={onChange} />);
    await user.keyboard('42');
    expect(onChange).toHaveBeenLastCalledWith('42');
  });

  it('distributes a pasted code across the boxes', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<OtpInput length={6} onComplete={onComplete} />);
    const inputs = boxes();
    inputs[0]!.focus();
    await user.paste('9 8 7-654');
    expect(boxes().map((input) => input.value)).toEqual(['9', '8', '7', '6', '5', '4']);
    expect(onComplete).toHaveBeenCalledWith('987654');
  });

  it('clears all boxes when resetKey changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OtpInput length={6} onComplete={() => {}} resetKey={0} />);
    await user.keyboard('123');
    expect(boxes()[2]!.value).toBe('3');
    rerender(<OtpInput length={6} onComplete={() => {}} resetKey={1} />);
    for (const input of boxes()) expect(input.value).toBe('');
  });

  it('renders the error message and marks boxes invalid', () => {
    render(
      <OtpInput length={6} onComplete={() => {}} error="That code doesn't match our email." />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("That code doesn't match our email.");
    for (const input of boxes()) expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('disables every box while verifying', () => {
    render(<OtpInput length={6} onComplete={() => {}} disabled />);
    for (const input of boxes()) expect(input).toBeDisabled();
  });
});
