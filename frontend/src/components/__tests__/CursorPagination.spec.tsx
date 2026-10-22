import { useRef, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CursorPagination from '../CursorPagination';

const PaginationPair = () => {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const props = {
    page,
    perPage,
    hasNext: page < 3,
    onPrevious: () => setPage((current) => current - 1),
    onNext: () => setPage((current) => current + 1),
    onPerPageSelect: (size: number) => {
      setPerPage(size);
      setPage(1);
    },
  };
  return (
    <>
      <CursorPagination variant="top" {...props} />
      <h2 ref={resultsRef} tabIndex={-1}>
        Results
      </h2>
      <CursorPagination variant="bottom" resultsRef={resultsRef} {...props} />
    </>
  );
};

const top = () =>
  within(screen.getByRole('navigation', { name: 'Top pagination' }));
const bottom = () =>
  within(screen.getByRole('navigation', { name: 'Bottom pagination' }));

describe('CursorPagination', () => {
  it('keeps both controls in sync and only offers page size below results', () => {
    render(<PaginationPair />);
    expect(top().queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      bottom().getByRole('combobox', { name: 'Items per page' }),
    ).toHaveValue('10');
    expect(
      top().getByRole('button', { name: 'Go to previous page' }),
    ).toBeDisabled();

    fireEvent.click(bottom().getByRole('button', { name: 'Go to next page' }));
    expect(top().getByText('Page 2')).toBeInTheDocument();
    expect(bottom().getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Results' })).toHaveFocus();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Page 2 loaded');

    fireEvent.click(top().getByRole('button', { name: 'Go to next page' }));
    expect(
      bottom().getByRole('button', { name: 'Go to next page' }),
    ).toBeDisabled();
    expect(bottom().getByText('Page 3')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Bottom pagination' }),
    ).not.toHaveTextContent('of 3');

    fireEvent.change(
      bottom().getByRole('combobox', { name: 'Items per page' }),
      {
        target: { value: '50' },
      },
    );
    expect(top().getByText('Page 1')).toBeInTheDocument();
    expect(
      bottom().getByRole('combobox', { name: 'Items per page' }),
    ).toHaveValue('50');
    expect(screen.getByRole('heading', { name: 'Results' })).toHaveFocus();
    const pageSize = bottom().getByRole('combobox', { name: 'Items per page' });
    pageSize.focus();
    fireEvent.change(pageSize, { target: { value: '20' } });
    expect(top().getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Results' })).toHaveFocus();
  });

  it('waits for a completed page and does not announce background refreshes', () => {
    const props = {
      variant: 'bottom' as const,
      page: 1,
      perPage: 10,
      hasNext: true,
      onPrevious: jest.fn(),
      onNext: jest.fn(),
      onPerPageSelect: jest.fn(),
    };
    const view = render(<CursorPagination {...props} />);
    view.rerender(<CursorPagination {...props} page={2} isLoading />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(
      screen.getByRole('button', { name: 'Go to next page' }),
    ).toBeDisabled();
    view.rerender(<CursorPagination {...props} page={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('Page 2 loaded');
    view.rerender(<CursorPagination {...props} page={2} isLoading />);
    view.rerender(<CursorPagination {...props} page={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('Page 2 loaded');
  });

  it('keeps Previous available but disables Next after a page error', () => {
    render(
      <CursorPagination
        variant="bottom"
        page={2}
        perPage={10}
        hasNext
        isError
        onPrevious={jest.fn()}
        onNext={jest.fn()}
        onPerPageSelect={jest.fn()}
      />,
    );
    expect(
      bottom().getByRole('button', { name: 'Go to previous page' }),
    ).toBeEnabled();
    expect(
      bottom().getByRole('button', { name: 'Go to next page' }),
    ).toBeDisabled();
  });

  it('keeps three-digit page labels together and supports keyboard navigation', async () => {
    const user = userEvent.setup();
    const onNext = jest.fn();
    render(
      <CursorPagination
        variant="bottom"
        page={123}
        perPage={10}
        hasNext
        onPrevious={jest.fn()}
        onNext={onNext}
        onPerPageSelect={jest.fn()}
      />,
    );
    expect(bottom().getByText('Page 123')).toHaveClass('pf-v6-u-text-nowrap');
    const next = bottom().getByRole('button', { name: 'Go to next page' });
    next.focus();
    await user.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
