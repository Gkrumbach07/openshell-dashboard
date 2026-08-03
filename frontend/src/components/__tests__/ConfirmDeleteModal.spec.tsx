import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDeleteModal from '../ConfirmDeleteModal';

const defaultProps = {
  title: 'Delete sandbox',
  body: 'Are you sure you want to delete this sandbox?',
  isOpen: true,
  isDeleting: false,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

describe('ConfirmDeleteModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title and body text', () => {
    render(<ConfirmDeleteModal {...defaultProps} />);
    expect(screen.getByText('Delete sandbox')).toBeInTheDocument();
    expect(
      screen.getByText('Are you sure you want to delete this sandbox?'),
    ).toBeInTheDocument();
  });

  it('calls onConfirm when delete button is clicked', () => {
    render(<ConfirmDeleteModal {...defaultProps} />);
    fireEvent.click(screen.getByTestId('confirm-delete'));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button is clicked', () => {
    render(<ConfirmDeleteModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows Delete button text by default', () => {
    render(<ConfirmDeleteModal {...defaultProps} />);
    expect(screen.getByTestId('confirm-delete')).toHaveTextContent('Delete');
  });

  it('shows Remove button text for remove variant', () => {
    render(<ConfirmDeleteModal {...defaultProps} variant="remove" />);
    expect(screen.getByTestId('confirm-delete')).toHaveTextContent('Remove');
  });

  it('disables confirm button while deleting', () => {
    render(<ConfirmDeleteModal {...defaultProps} isDeleting={true} />);
    expect(screen.getByTestId('confirm-delete')).toBeDisabled();
  });

  it('displays error alert when error is provided', () => {
    render(
      <ConfirmDeleteModal {...defaultProps} error="Network error occurred" />,
    );
    expect(screen.getByText('Network error occurred')).toBeInTheDocument();
  });

  it('requires name match when confirmName is set', () => {
    render(<ConfirmDeleteModal {...defaultProps} confirmName="my-sandbox" />);
    const confirmBtn = screen.getByTestId('confirm-delete');
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByTestId('confirm-delete-name-input');
    fireEvent.change(input, { target: { value: 'my-sandbox' } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('does not render when isOpen is false', () => {
    render(<ConfirmDeleteModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Delete sandbox')).not.toBeInTheDocument();
  });
});
