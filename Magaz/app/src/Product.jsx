import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import Header from "./Header";
import "./Style/Product.css";
import StarRating from "./Elements/StarRating";
import ProductVariations from "./Elements/ProductVariations";
import ProductSizes from "./Elements/ProductSizes";
import ProductActions from "./Elements/ProductActions";
import ReviewMenu from "./Elements/ReviewMenu";
import ReviewsList from "./Elements/ReviewsList";

const API_URL = "http://localhost:8000";

function Product() {
    // ПОЛУЧЕНИЕ ID ПРОДУКТА ИЗ URL
    const { id } = useParams();

    // STATE ПЕРЕМЕННЫЕ
    const [data, setData] = useState([]);                      // Все продукты из API
    const [loading, setLoading] = useState(true);              // Индикатор загрузки
    const [activeVariation, setActiveVariation] = useState(0); // Активная вариация (цвет)
    const [activeSize, setActiveSize] = useState(null);        // Активный размер
    const [hoveredVariation, setHoveredVariation] = useState(null); // Наведенная вариация
    const [hoveredSize, setHoveredSize] = useState(null);      // Наведенный размер
    const [isFavorite, setIsFavorite] = useState(false);       // В избранном или нет
    const [cartItems, setCartItems] = useState([]);            // Товары в корзине
    const [addingToCart, setAddingToCart] = useState(false);   // Процесс добавления в корзину
    const [isAuthenticated, setIsAuthenticated] = useState(false); // Залогинен ли пользователь
    const [currentUserId, setCurrentUserId] = useState(null);  // ID текущего пользователя
    const [canReview, setCanReview] = useState(false);         // Может ли оставить отзыв

    // ЗАГРУЗКА ДАННЫХ ПРИ МОНТИРОВАНИИ
    useEffect(() => {
        loadProductData();
    }, [id]);

    // ФУНКЦИЯ ЗАГРУЗКИ ВСЕХ ДАННЫХ
    // Загружает: продукты, избранное, корзину, пользователя
    const loadProductData = async () => {
        setLoading(true);
        try {
            const [products, favorites, cart, user] = await Promise.all([
                fetch(`${API_URL}/api-products`).then(r => r.json()),
                fetch(`${API_URL}/api/favorites`, { credentials: "include" })
                    .then(r => r.ok ? r.json() : [])
                    .catch(() => []),
                fetch(`${API_URL}/api/cart`, { credentials: "include" })
                    .then(r => r.ok ? r.json() : [])
                    .catch(() => []),
                fetch(`${API_URL}/api/me`, { credentials: "include" })
                    .then(r => r.ok ? r.json() : null)
                    .catch(() => null),
            ]);

            setData(products);
            setCartItems(cart);
            setIsFavorite(favorites.some(f => f.product_id === parseInt(id, 10)));

            if (user) {
                setCurrentUserId(user.id);
                setIsAuthenticated(true);
                checkCanReview(); // Проверяем возможность оставить отзыв
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // ПРОВЕРКА: МОЖЕТ ЛИ ПОЛЬЗОВАТЕЛЬ ОСТАВИТЬ ОТЗЫВ
    // Условия: купил товар и еще не оставлял отзыв
    const checkCanReview = async () => {
        try {
            const response = await fetch(`${API_URL}/api/reviews/can-review/${id}`, {
                credentials: "include",
            });
            if (response.ok) {
                const data = await response.json();
                setCanReview(data.can_review);
            }
        } catch (error) {
            setCanReview(false);
        }
    };

    // ФИЛЬТРАЦИЯ ВАРИАЦИЙ С ДОСТУПНЫМИ РАЗМЕРАМИ
    // Возвращает только те вариации, у которых есть размеры с stock > 0
    const getAvailableVariations = (product) => {
        if (!product?.variations) return [];
        return product.variations
            .filter(v => v.sizes.some(s => s.stock_quantity > 0))
            .map(v => ({
                ...v,
                sizes: v.sizes.filter(s => s.stock_quantity > 0)
            }));
    };

    // УСТАНОВКА ПЕРВОГО РАЗМЕРА ПРИ ЗАГРУЗКЕ
    useEffect(() => {
        if (data.length > 0) {
            const prod = data.find(item => item.id === parseInt(id, 10));
            if (prod) {
                const availableVariations = getAvailableVariations(prod);
                if (availableVariations[activeVariation]?.sizes?.[0]) {
                    const firstSize = availableVariations[activeVariation].sizes[0];
                    setActiveSize({ id: firstSize.id, name: firstSize.size_name });
                }
            }
        }
    }, [data, activeVariation, id]);

    // СМЕНА ВАРИАЦИИ
    // Автоматически выбирает первый доступный размер если текущего нет
    const handleVariationClick = (index) => {
        setActiveVariation(index);
        const prod = data.find(item => item.id === parseInt(id, 10));
        const availableVariations = getAvailableVariations(prod);
        const newVariation = availableVariations[index];
        if (activeSize) {
            const sizeExists = newVariation.sizes.some(s => s.size_name === activeSize.name);
            if (!sizeExists && newVariation.sizes.length > 0) {
                const firstSize = newVariation.sizes[0];
                setActiveSize({ id: firstSize.id, name: firstSize.size_name });
            }
        }
    };

    // ДОБАВЛЕНИЕ/УДАЛЕНИЕ ИЗ КОРЗИНЫ
    const handleToggleCart = async () => {
        // Проверка авторизации
        if (!isAuthenticated) {
            window.location.href = "/login";
            return;
        }

        const prod = data.find(item => item.id === parseInt(id, 10));
        const availableVariations = getAvailableVariations(prod);
        const currentVariation = availableVariations[activeVariation];
        if (!currentVariation || !activeSize) return;

        setAddingToCart(true);

        try {
            const cartInfo = getCartInfo();
            if (cartInfo) {
                // Удаление из корзины
                await fetch(`${API_URL}/api/cart/${cartInfo.cart_item_id}`, {
                    method: "DELETE",
                    credentials: "include",
                });
            } else {
                // Добавление в корзину
                await fetch(`${API_URL}/api/cart/add`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                        product_id: prod.id,
                        variation_id: currentVariation.id,
                        size_id: activeSize.id,
                        quantity: 1,
                    }),
                });
            }

            // Обновление корзины
            const cartResponse = await fetch(`${API_URL}/api/cart`, { credentials: "include" });
            if (cartResponse.ok) {
                const updatedCart = await cartResponse.json();
                setCartItems(updatedCart);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setAddingToCart(false);
        }
    };

    // ИЗМЕНЕНИЕ КОЛИЧЕСТВА ТОВАРА В КОРЗИНЕ
    // Проверяет: не превышает ли количество stock_quantity
    const handleUpdateQuantity = async (newQuantity) => {
        const cartInfo = getCartInfo();
        if (newQuantity < 1 || !cartInfo) return;

        const prod = data.find(item => item.id === parseInt(id, 10));
        if (!prod) return;

        const availableVariations = getAvailableVariations(prod);
        const currentVariation = availableVariations[activeVariation];
        const currentSize = currentVariation.sizes.find(s => s.id === activeSize.id);

        // Блокировка увеличения если превышает запас
        if (newQuantity > currentSize.stock_quantity) return;

        try {
            const response = await fetch(`${API_URL}/api/cart/${cartInfo.cart_item_id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ quantity: newQuantity }),
            });

            if (response.ok) {
                const cartResponse = await fetch(`${API_URL}/api/cart`, { credentials: "include" });
                if (cartResponse.ok) {
                    const updatedCart = await cartResponse.json();
                    setCartItems(updatedCart);
                }
            }
        } catch (error) {
            console.error(error);
        }
    };

    // ДОБАВЛЕНИЕ/УДАЛЕНИЕ ИЗ ИЗБРАННОГО
    const handleToggleFavorite = async () => {
        if (!isAuthenticated) {
            window.location.href = "/login";
            return;
        }

        const prod = data.find(item => item.id === parseInt(id, 10));
        const method = isFavorite ? "DELETE" : "POST";
        const url = isFavorite
            ? `${API_URL}/api/favorites/${prod.id}`
            : `${API_URL}/api/favorites/add`;

        try {
            const response = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: method === "POST" ? JSON.stringify({ product_id: prod.id }) : undefined,
            });

            if (response.ok) {
                setIsFavorite(!isFavorite);
            }
        } catch (error) {
            console.error(error);
        }
    };

    // ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ТОВАРЕ В КОРЗИНЕ
    // Возвращает объект товара если он в корзине, иначе null
    const getCartInfo = () => {
        if (!activeSize) return null;
        const prod = data.find(item => item.id === parseInt(id, 10));
        if (!prod) return null;
        const availableVariations = getAvailableVariations(prod);
        const currentVariation = availableVariations[activeVariation];
        return cartItems.find(
            item =>
                item.product_id === prod.id &&
                item.variation_id === currentVariation.id &&
                item.size_id === activeSize.id
        );
    };

    // ПРОВЕРКА: ЕСТЬ ЛИ ВАРИАЦИЯ В КОРЗИНЕ
    // Для отображения синей точки на вариации
    const isVariationInCart = (variationId) => {
        return cartItems.some(item => item.product_id === parseInt(id, 10) && item.variation_id === variationId);
    };

    // ПРОВЕРКА: ЕСТЬ ЛИ РАЗМЕР В КОРЗИНЕ
    // Для отображения синей точки на размере
    const isSizeInCart = (sizeId) => {
        const prod = data.find(item => item.id === parseInt(id, 10));
        if (!prod) return false;
        const availableVariations = getAvailableVariations(prod);
        const currentVariation = availableVariations[activeVariation];
        return cartItems.some(item =>
            item.product_id === prod.id &&
            item.variation_id === currentVariation.id &&
            item.size_id === sizeId
        );
    };

    // ПОЛУЧЕНИЕ ИНДЕКСА АКТИВНОГО РАЗМЕРА
    // Для подсветки активного размера
    const getActiveSizeIndex = () => {
        const prod = data.find(item => item.id === parseInt(id, 10));
        if (!prod) return 0;
        const availableVariations = getAvailableVariations(prod);
        const currentVariation = availableVariations[activeVariation];
        if (!currentVariation || !activeSize) return 0;
        return currentVariation.sizes.findIndex(s => s.size_name === activeSize.name);
    };

    // ЭКРАН ЗАГРУЗКИ
    if (loading) {
        return (
            <div id="mask" className="mask">
                <svg>
                    <circle cx="50" cy="50" r="40" />
                </svg>
            </div>
        );
    }

    // ПОИСК ПРОДУКТА ПО ID
    const prod = data.find(item => item.id === parseInt(id, 10));
    if (!prod) {
        return (
            <div className="center">
                <section className="text-section">
                    <h1 className="main-title">Error 404</h1>
                    <p className="subtitle">Page not found</p>
                </section>
            </div>
        );
    }

    // ВЫЧИСЛЕНИЕ ДАННЫХ ДЛЯ РЕНДЕРА
    const availableVariations = getAvailableVariations(prod);        // Вариации с доступными размерами
    const currentVariation = availableVariations[activeVariation];   // Текущая вариация
    const currentSize = currentVariation?.sizes.find(s => s.id === activeSize?.id); // Текущий размер
    const maxStock = currentSize?.stock_quantity || 999;             // Максимальное количество на складе
    const cartInfo = getCartInfo();                                  // Информация о товаре в корзине
    const isInCart = !!cartInfo;                                     // Находится ли товар в корзине
    const cartQuantity = cartInfo?.quantity || 1;                    // Количество в корзине

    // Сортировка отзывов по дате
    const sortedReviews = prod.reviews ? [...prod.reviews].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
    ) : [];
    
    // Расчет среднего рейтинга
    const averageRating = sortedReviews.length > 0
        ? (sortedReviews.reduce((sum, r) => sum + r.rating, 0) / sortedReviews.length).toFixed(1)
        : "0.0";

    return (
        <>
            <Header />
            <main className="product-page">
                <div className="product-image-wrapper">
                    {currentVariation && (
                        <img src={currentVariation.image} alt={prod.title} className="product-main-image" />
                    )}
                </div>

                <div className="product-info">
                    <h1 className="product-title">{prod.title}</h1>
                    <p className="product-description">{prod.description}</p>
                    <h2 className="product-price">{prod.price}$</h2>

                    <ProductVariations
                        variations={availableVariations}
                        activeIndex={activeVariation}
                        hoveredIndex={hoveredVariation}
                        onVariationClick={handleVariationClick}
                        onVariationHover={setHoveredVariation}
                        isVariationInCart={isVariationInCart}
                    />

                    <ProductSizes
                        sizes={currentVariation?.sizes}
                        activeSize={activeSize}
                        hoveredIndex={hoveredSize}
                        activeSizeIndex={getActiveSizeIndex()}
                        onSizeClick={(id, name) => setActiveSize({ id, name })}
                        onSizeHover={setHoveredSize}
                        isSizeInCart={isSizeInCart}
                    />

                    <ProductActions
                        isInCart={isInCart}
                        isFavorite={isFavorite}
                        cartQuantity={cartQuantity}
                        addingToCart={addingToCart}
                        maxStock={maxStock}
                        onToggleCart={handleToggleCart}
                        onUpdateQuantity={handleUpdateQuantity}
                        onToggleFavorite={handleToggleFavorite}
                    />

                    <div className="product-characteristics">
                        <p>{prod.characteristics}</p>
                    </div>

                    <section className="product-reviews">
                        <div className="reviews-header">
                            <h3>Reviews ({sortedReviews.length})</h3>
                            <div className="reviews-header-right">
                                <StarRating rating={parseFloat(averageRating)} />
                                <ReviewMenu
                                    productId={prod.id}
                                    isAuthenticated={isAuthenticated}
                                    canReview={canReview}
                                    onReviewSubmitted={() => window.location.reload()}
                                />
                            </div>
                        </div>
                        <ReviewsList
                            reviews={prod.reviews}
                            currentUserId={currentUserId}
                            onReviewDeleted={() => window.location.reload()}
                        />
                    </section>
                </div>
            </main>
        </>
    );
}

export default Product